use crate::acl::{authorize_publish_with_retain, authorize_subscribe, parse_meshcore_topic};
use crate::auth::{AuthService, Principal, principal_from_username};
use crate::config::{Config, SubscriberRole};
use crate::error::ObserverError;
use crate::meshcore_io::MeshcoreIoRuntime;
use crate::routing::{DENIED_WILL_SINK_TOPIC, filter_limited_payload};
use crate::status_guard::StatusGuard;
use crate::target_bridge::TargetBridge;
use async_trait::async_trait;
use bytes::Bytes;
use rmqtt::codec::types::QoS;
use rmqtt::codec::v5::SubscribeAckReason;
use rmqtt::context::ServerContext;
use rmqtt::hook::{Handler, HookResult, Parameter, Register, ReturnType, Type};
use rmqtt::types::{
    AuthResult, CodecPublish, From, FromType, Publish, PublishAclResult, SubscribeReturn,
};
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Grace window to flush a broker-originated QoS 0 error notification to the
/// observer's transport before closing a denial-flagged connection. Mirrors
/// the legacy `ERROR_NOTIFY_FLUSH_MS` behavior: QoS 0 has no PUBACK, so the
/// close is deferred by this bounded window instead of racing the write.
const ERROR_NOTIFY_FLUSH: Duration = Duration::from_millis(100);

#[derive(Clone)]
pub struct MeshcoreHandler {
    config: Arc<Config>,
    auth: AuthService,
    scx: ServerContext,
    observer_sessions: Arc<Mutex<HashMap<String, rmqtt::types::Id>>>,
    target: Option<TargetBridge>,
    meshcore_io: Option<MeshcoreIoRuntime>,
    status_guard: StatusGuard,
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
            status_guard: StatusGuard::new(),
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
        let iata = denial_iata(error);
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
        // Route through the ordinary broker routing, like the legacy
        // aedes.publish: the notification reaches the denied observer (when
        // subscribed to its own error topic) and admin meshcore/# subscribers.
        // The RoleRouter keeps the private error payload away from limited
        // and full-access subscriber roles.
        match self
            .scx
            .extends
            .shared()
            .await
            .forwards(None, from, publish)
            .await
        {
            Ok(recipients) => {
                if recipients == 0 {
                    tracing::debug!(code = %error.code, client = %session.id, "observer error notification had no subscribers");
                }
            }
            Err((recipients, errors)) => {
                tracing::warn!(code = %error.code, client = %session.id, recipients, failures = errors.len(), "observer error notification had delivery failures");
            }
        }
    }

    /// Schedule a bounded close so a denial-flagged connection flushes its
    /// pending QoS 0 notification first. The RMQTT session loop abandons its
    /// delivery queue the moment a closing ACL rejection returns, so the
    /// close must be deferred behind the flush window like the legacy broker.
    fn close_after_flush(&self, id: rmqtt::types::Id) {
        let scx = self.scx.clone();
        tokio::spawn(async move {
            tokio::time::sleep(ERROR_NOTIFY_FLUSH).await;
            let mut entry = scx.extends.shared().await.entry(id);
            if let Err(error) = entry.kick(true, true, false).await {
                tracing::debug!(%error, "denial close: session already gone");
            }
        });
    }
}

/// Resolve the IATA segment of an observer error topic the way the legacy
/// broker did: prefer a usable IATA carried by the denial, then one recovered
/// from the denied topic, and fall back to the XXX placeholder only when
/// nothing usable exists. "test" is routed to the exact lowercase test topic,
/// every other usable code is routed uppercased.
fn denial_iata(error: &ObserverError) -> String {
    if let Some(iata) = error.iata.as_deref().and_then(normalize_denial_iata) {
        return iata;
    }
    if let Some(iata) = extract_topic_iata(error.topic.as_deref()) {
        return iata;
    }
    "XXX".to_owned()
}

fn normalize_denial_iata(value: &str) -> Option<String> {
    if value.eq_ignore_ascii_case("test") {
        return Some("test".to_owned());
    }
    let upper = value.to_ascii_uppercase();
    (upper.len() == 3 && upper.bytes().all(|byte| byte.is_ascii_alphabetic())).then_some(upper)
}

/// Best-effort IATA recovery from a denied topic, mirroring the legacy
/// extractTopicIata: `meshcore/<3-letter-code>/...` yields the uppercase
/// code (or exact "test" for the test ingress).
fn extract_topic_iata(topic: Option<&str>) -> Option<String> {
    let topic = topic?;
    let mut parts = topic.split('/');
    if parts.next() != Some("meshcore") {
        return None;
    }
    let candidate = parts.next()?.trim();
    parts.next()?;
    if candidate.eq_ignore_ascii_case("test") {
        return Some("test".to_owned());
    }
    normalize_denial_iata(candidate)
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
                        if error.close {
                            // The legacy broker closed the observer socket when
                            // it subscribed outside its own error/serial topics.
                            self.close_after_flush(session.id.clone());
                        }
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
                match authorize_publish_with_retain(
                    &self.config,
                    &principal,
                    owns,
                    publish.topic.as_ref(),
                    publish.payload.as_ref(),
                    publish.retain,
                ) {
                    Ok(_) => {
                        // The legacy broker rejects status messages whose
                        // device timestamp is older than the newest accepted
                        // one per public key, before routing or forwarding.
                        if let Principal::Publisher { public_key } = &principal
                            && parse_meshcore_topic(publish.topic.as_ref()).is_some_and(|parsed| {
                                parsed.subtopic.eq_ignore_ascii_case("status")
                            })
                            && let Err(mut error) = self
                                .status_guard
                                .accept_status(public_key, publish.payload.as_ref())
                        {
                            error.topic = Some(
                                String::from_utf8_lossy(publish.topic.as_bytes()).into_owned(),
                            );
                            if let Some(parsed) = parse_meshcore_topic(publish.topic.as_ref()) {
                                error.iata = Some(parsed.iata);
                            }
                            tracing::warn!(client = %session.id, code = %error.code, topic = %publish.topic, "publish denied");
                            self.notify_denial(session, &principal, &error).await;
                            return (
                                false,
                                Some(HookResult::PublishAclResult(PublishAclResult::rejected(
                                    false,
                                    Some(error.reason().into()),
                                ))),
                            );
                        }
                        (
                            false,
                            Some(HookResult::PublishAclResult(PublishAclResult::allow())),
                        )
                    }
                    Err(error) => {
                        tracing::warn!(client = %session.id, code = %error.code, topic = %publish.topic, "publish denied");
                        self.notify_denial(session, &principal, &error).await;
                        if error.close {
                            self.close_after_flush(session.id.clone());
                        }
                        (
                            false,
                            Some(HookResult::PublishAclResult(PublishAclResult::rejected(
                                false,
                                Some(error.reason().into()),
                            ))),
                        )
                    }
                }
            }
            Parameter::MessagePublish(_, from, publish)
                if matches!(from.typ(), FromType::LastWill) =>
            {
                let Some(principal) = self.principal(from.id.username_ref()) else {
                    let mut denied = (*publish).clone();
                    denied.topic = DENIED_WILL_SINK_TOPIC.into();
                    denied.payload = Bytes::new();
                    denied.retain = false;
                    return (false, Some(HookResult::Publish(denied)));
                };
                let owns = match &principal {
                    Principal::Publisher { public_key } => self
                        .auth
                        .is_observer_owner(public_key, &from.id.to_string()),
                    _ => true,
                };
                match authorize_publish_with_retain(
                    &self.config,
                    &principal,
                    owns,
                    publish.topic.as_ref(),
                    publish.payload.as_ref(),
                    publish.retain,
                ) {
                    Ok(allowed) => {
                        if let Principal::Publisher { public_key } = &principal
                            && parse_meshcore_topic(publish.topic.as_ref()).is_some_and(|parsed| {
                                parsed.subtopic.eq_ignore_ascii_case("status")
                            })
                            && let Err(error) = self
                                .status_guard
                                .accept_status(public_key, publish.payload.as_ref())
                        {
                            tracing::warn!(client = %from.id, code = %error.code, topic = %publish.topic, "last will status denied");
                            let mut denied = (*publish).clone();
                            denied.topic = DENIED_WILL_SINK_TOPIC.into();
                            denied.payload = Bytes::new();
                            denied.retain = false;
                            return (false, Some(HookResult::Publish(denied)));
                        }
                        let mut changed = (*publish).clone();
                        changed.topic = allowed.topic.into();
                        changed.retain = allowed.retain;
                        if let Principal::Publisher { public_key } = &principal {
                            let topic: &str = changed.topic.as_ref();
                            if let Some(target) = &self.target {
                                target.offer_publish_with_retain(
                                    public_key,
                                    topic,
                                    changed.payload.clone(),
                                    changed.retain,
                                );
                            }
                            if !topic.starts_with("meshcore/test/")
                                && let Some(meshcore_io) = &self.meshcore_io
                            {
                                meshcore_io.offer_publish(topic, changed.payload.as_ref());
                            }
                        }
                        (false, Some(HookResult::Publish(changed)))
                    }
                    Err(error) => {
                        tracing::warn!(client = %from.id, code = %error.code, topic = %publish.topic, "last will denied");
                        let mut denied = (*publish).clone();
                        denied.topic = DENIED_WILL_SINK_TOPIC.into();
                        denied.payload = Bytes::new();
                        denied.retain = false;
                        (false, Some(HookResult::Publish(denied)))
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
                if let Ok(allowed) = authorize_publish_with_retain(
                    &self.config,
                    &principal,
                    owns,
                    publish.topic.as_ref(),
                    publish.payload.as_ref(),
                    publish.retain,
                ) {
                    let mut changed = (*publish).clone();
                    changed.topic = allowed.topic.into();
                    changed.retain = allowed.retain;
                    if let Principal::Publisher { public_key } = &principal {
                        let topic: &str = changed.topic.as_ref();
                        if let Some(target) = &self.target {
                            target.offer_publish_with_retain(
                                public_key,
                                topic,
                                changed.payload.clone(),
                                changed.retain,
                            );
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

#[cfg(test)]
mod tests {
    use super::*;

    fn error_with(iata: Option<&str>, topic: Option<&str>) -> ObserverError {
        let mut error =
            ObserverError::new(crate::error::ObserverErrorCode::PublishInvalidJson, "x");
        error.iata = iata.map(str::to_owned);
        error.topic = topic.map(str::to_owned);
        error
    }

    #[test]
    fn denial_iata_prefers_error_iata_then_topic_then_placeholder() {
        // Explicit denial IATA wins and is normalized.
        assert_eq!(
            denial_iata(&error_with(Some("sto"), Some("meshcore/STO/ABCD/packets"))),
            "STO"
        );
        // A denial without IATA recovers it from the denied topic.
        assert_eq!(
            denial_iata(&error_with(None, Some("meshcore/ARN/ABCD/packets"))),
            "ARN"
        );
        // Mixed-case topics normalize, test stays lowercase.
        assert_eq!(
            denial_iata(&error_with(None, Some("meshcore/tEsT/ABCD/packets"))),
            "test"
        );
        assert_eq!(
            denial_iata(&error_with(None, Some("meshcore/sto/ABCD/packets"))),
            "STO"
        );
        // Unusable IATA or topic falls back to the XXX placeholder.
        assert_eq!(
            denial_iata(&error_with(Some("AB"), Some("meshcore/AB/ABCD/packets"))),
            "XXX"
        );
        assert_eq!(
            denial_iata(&error_with(None, Some("meshcore/ABCD/packets"))),
            "XXX"
        );
        assert_eq!(denial_iata(&error_with(None, None)), "XXX");
        assert_eq!(denial_iata(&error_with(None, Some("other/topic"))), "XXX");
    }

    #[test]
    fn extract_topic_iata_requires_the_meshcore_shape() {
        assert_eq!(
            extract_topic_iata(Some("meshcore/STO/ABCD/packets")).as_deref(),
            Some("STO")
        );
        assert_eq!(
            extract_topic_iata(Some("meshcore/ARN/ABCD/x")).as_deref(),
            Some("ARN")
        );
        assert_eq!(
            extract_topic_iata(Some("meshcore/test/ABCD/packets")).as_deref(),
            Some("test")
        );
        assert_eq!(extract_topic_iata(Some("meshcore/STO")), None);
        assert_eq!(extract_topic_iata(Some("meshcore/ABCD")), None);
        assert_eq!(extract_topic_iata(Some("meshcore/AB/ABCD/x")), None);
        assert_eq!(extract_topic_iata(Some("meshcore/1234/ABCD/x")), None);
        assert_eq!(extract_topic_iata(None), None);
    }
}
