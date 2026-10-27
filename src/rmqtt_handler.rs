use crate::acl::{authorize_publish, authorize_subscribe};
use crate::auth::{AuthService, Principal, principal_from_username};
use crate::config::{Config, SubscriberRole};
use crate::error::ObserverError;
use crate::meshcore_io::MeshcoreIoRuntime;
use crate::routing::filter_limited_payload;
use crate::target_bridge::TargetBridge;
use async_trait::async_trait;
use bytes::Bytes;
use rmqtt::codec::types::QoS;
use rmqtt::codec::v5::SubscribeAckReason;
use rmqtt::context::ServerContext;
use rmqtt::hook::{Handler, HookResult, Parameter, Register, ReturnType, Type};
use rmqtt::types::{AuthResult, CodecPublish, From, Publish, PublishAclResult, SubscribeReturn};
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone)]
pub struct MeshcoreHandler {
    config: Arc<Config>,
    auth: AuthService,
    scx: ServerContext,
    observer_sessions: Arc<Mutex<HashMap<String, rmqtt::types::Id>>>,
    target: Option<TargetBridge>,
    meshcore_io: Option<MeshcoreIoRuntime>,
}

impl MeshcoreHandler {
    pub fn new(config: Arc<Config>, scx: ServerContext) -> Self {
        Self {
            auth: AuthService::new(config.clone()),
            config,
            scx,
            observer_sessions: Arc::new(Mutex::new(HashMap::new())),
            target: None,
            meshcore_io: None,
        }
    }

    pub fn with_integrations(
        mut self,
        target: Option<TargetBridge>,
        meshcore_io: Option<MeshcoreIoRuntime>,
    ) -> Self {
        self.target = target;
        self.meshcore_io = meshcore_io;
        self
    }

    pub fn observer_count(&self) -> usize {
        self.observer_sessions
            .lock()
            .expect("observer session lock")
            .len()
    }

    pub async fn register(&self) -> Box<dyn Register> {
        let register = self.scx.extends.hook_mgr().register();
        for typ in [
            Type::ClientAuthenticate,
            Type::ClientSubscribeCheckAcl,
            Type::MessagePublishCheckAcl,
            Type::MessagePublish,
            Type::MessageDelivered,
            Type::ClientDisconnected,
            Type::SessionTerminated,
        ] {
            register
                .add_priority(typ, u32::MAX, Box::new(self.clone()))
                .await;
        }
        register.start().await;
        register
    }

    fn principal(&self, username: &str) -> Option<Principal> {
        principal_from_username(&self.config, username)
    }

    async fn notify_denial(
        &self,
        session: &rmqtt::session::Session,
        principal: &Principal,
        error: &ObserverError,
    ) {
        let Principal::Publisher { public_key } = principal else {
            return;
        };
        let iata = error.iata.as_deref().unwrap_or("XXX");
        let packet = CodecPublish {
            dup: false,
            retain: false,
            qos: QoS::AtMostOnce,
            topic: format!("meshcore/{iata}/{public_key}/error").into(),
            packet_id: None,
            payload: Bytes::from(error.notification()),
            properties: None,
        };
        let publish = Publish::from(packet);
        let from = From::from_system(session.id.clone());
        // Deliver only to the denied observer connection. This prevents its
        // private error payload from leaking to meshcore/# subscribers.
        if self
            .scx
            .extends
            .shared()
            .await
            .entry(session.id.clone())
            .publish(from, publish)
            .await
            .is_err()
        {
            tracing::warn!(code = %error.code, client = %session.id, "could not deliver observer error notification");
        }
    }
}

#[async_trait]
impl Handler for MeshcoreHandler {
    async fn hook(&self, param: &Parameter, acc: Option<HookResult>) -> ReturnType {
        match param {
            Parameter::ClientAuthenticate(info) => {
                let username = info.username().map(AsRef::as_ref).unwrap_or_default();
                let password = info.password().map(AsRef::as_ref).unwrap_or_default();
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs() as i64;
                match self
                    .auth
                    .authenticate(&info.id().to_string(), username, password, now)
                {
                    Ok(principal) => {
                        tracing::info!(client = %info.id(), ?principal, "client authenticated");
                        if let Principal::Publisher { public_key } = &principal {
                            let previous = self
                                .observer_sessions
                                .lock()
                                .expect("observer session lock")
                                .insert(public_key.clone(), info.id().clone());
                            if let Some(previous) =
                                previous.filter(|id| id.to_string() != info.id().to_string())
                            {
                                let mut entry =
                                    self.scx.extends.shared().await.entry(previous.clone());
                                if let Err(error) = entry.kick(true, true, false).await {
                                    tracing::warn!(client = %previous, %error, "could not close replaced observer connection");
                                }
                            }
                        }
                        (
                            false,
                            Some(HookResult::AuthResult(AuthResult::Allow(false, None))),
                        )
                    }
                    Err(error) => {
                        tracing::warn!(client = %info.id(), code = %error.code, detail = %error.message, "authentication denied");
                        (
                            false,
                            Some(HookResult::AuthResult(AuthResult::NotAuthorized)),
                        )
                    }
                }
            }
            Parameter::ClientSubscribeCheckAcl(session, subscribe) => {
                let username = session.id.username_ref();
                let Some(principal) = self.principal(username) else {
                    return (
                        false,
                        Some(HookResult::SubscribeAclResult(
                            SubscribeReturn::new_failure(SubscribeAckReason::NotAuthorized),
                        )),
                    );
                };
                let owns = match &principal {
                    Principal::Publisher { public_key } => self
                        .auth
                        .is_observer_owner(public_key, &session.id.to_string()),
                    _ => true,
                };
                match authorize_subscribe(
                    &self.config,
                    &principal,
                    owns,
                    subscribe.topic_filter.as_ref(),
                ) {
                    Ok(()) => (
                        false,
                        Some(HookResult::SubscribeAclResult(
                            SubscribeReturn::new_success(subscribe.opts.qos(), None),
                        )),
                    ),
                    Err(error) => {
                        tracing::warn!(client = %session.id, code = %error.code, topic = %subscribe.topic_filter, "subscription denied");
                        self.notify_denial(session, &principal, &error).await;
                        (
                            false,
                            Some(HookResult::SubscribeAclResult(
                                SubscribeReturn::new_failure(SubscribeAckReason::NotAuthorized),
                            )),
                        )
                    }
                }
            }
            Parameter::MessagePublishCheckAcl(session, publish) => {
                let Some(principal) = self.principal(session.id.username_ref()) else {
                    return (
                        false,
                        Some(HookResult::PublishAclResult(PublishAclResult::rejected(
                            true,
                            Some("[PUBLISH_UNKNOWN_CLIENT] authenticate first".into()),
                        ))),
                    );
                };
                let owns = match &principal {
                    Principal::Publisher { public_key } => self
                        .auth
                        .is_observer_owner(public_key, &session.id.to_string()),
                    _ => true,
                };
                match authorize_publish(
                    &self.config,
                    &principal,
                    owns,
                    publish.topic.as_ref(),
                    publish.payload.as_ref(),
                ) {
                    Ok(_) => (
                        false,
                        Some(HookResult::PublishAclResult(PublishAclResult::allow())),
                    ),
                    Err(error) => {
                        tracing::warn!(client = %session.id, code = %error.code, topic = %publish.topic, "publish denied");
                        self.notify_denial(session, &principal, &error).await;
                        (
                            false,
                            Some(HookResult::PublishAclResult(PublishAclResult::rejected(
                                error.close,
                                Some(error.reason().into()),
                            ))),
                        )
                    }
                }
            }
            Parameter::MessagePublish(Some(session), _, publish) => {
                let Some(principal) = self.principal(session.id.username_ref()) else {
                    return (false, Some(HookResult::Publish((*publish).clone())));
                };
                let owns = match &principal {
                    Principal::Publisher { public_key } => self
                        .auth
                        .is_observer_owner(public_key, &session.id.to_string()),
                    _ => true,
                };
                if let Ok(allowed) = authorize_publish(
                    &self.config,
                    &principal,
                    owns,
                    publish.topic.as_ref(),
                    publish.payload.as_ref(),
                ) {
                    let mut changed = (*publish).clone();
                    changed.topic = allowed.topic.into();
                    changed.retain = allowed.retain;
                    if let Principal::Publisher { public_key } = &principal {
                        let topic: &str = changed.topic.as_ref();
                        if let Some(target) = &self.target {
                            target.offer_publish(public_key, topic, changed.payload.clone());
                        }
                        if !topic.starts_with("meshcore/test/")
                            && let Some(meshcore_io) = &self.meshcore_io
                        {
                            meshcore_io.offer_publish(topic, changed.payload.as_ref());
                        }
                    }
                    (false, Some(HookResult::Publish(changed)))
                } else {
                    (false, None)
                }
            }
            Parameter::MessageDelivered(session, _, publish) => {
                let principal = self.principal(session.id.username_ref());
                if matches!(
                    principal,
                    Some(Principal::Subscriber {
                        role: SubscriberRole::Limited,
                        ..
                    })
                ) && let Some(payload) =
                    filter_limited_payload(publish.topic.as_ref(), publish.payload.as_ref())
                {
                    let mut filtered = (*publish).clone();
                    filtered.payload = Bytes::from(payload);
                    return (false, Some(HookResult::Publish(filtered)));
                }
                (true, acc)
            }
            Parameter::ClientDisconnected(session, _)
            | Parameter::SessionTerminated(session, _) => {
                self.auth
                    .release(&session.id.to_string(), session.id.username_ref());
                self.observer_sessions
                    .lock()
                    .expect("observer session lock")
                    .retain(|_, id| id.to_string() != session.id.to_string());
                (true, acc)
            }
            _ => (true, acc),
        }
    }
}
