use crate::mqtt::auth::Principal;
use crate::mqtt::errors::ObserverError;
use bytes::Bytes;
use rmqtt::codec::types::QoS;
use rmqtt::context::ServerContext;
use rmqtt::types::{CodecPublish, From, Publish};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::task::JoinHandle;

const ERROR_NOTIFY_FLUSH: Duration = Duration::from_millis(100);

#[derive(Clone)]
pub(super) struct DenialNotifier {
    scx: ServerContext,
    delayed_closes: Arc<Mutex<Vec<JoinHandle<()>>>>,
}

impl DenialNotifier {
    pub(super) fn new(scx: ServerContext) -> Self {
        Self {
            scx,
            delayed_closes: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub(super) async fn notify(
        &self,
        session: &rmqtt::session::Session,
        principal: &Principal,
        error: &ObserverError,
    ) {
        let Principal::Publisher { public_key } = principal else {
            return;
        };
        let packet = CodecPublish {
            dup: false,
            retain: false,
            qos: QoS::AtMostOnce,
            topic: format!("meshcore/{}/{public_key}/error", denial_iata(error)).into(),
            packet_id: None,
            payload: Bytes::from(error.notification()),
            properties: None,
        };
        let from = From::from_system(session.id.clone());
        match self
            .scx
            .extends
            .shared()
            .await
            .forwards(None, from, Publish::from(packet))
            .await
        {
            Ok(0) => {
                tracing::debug!(code = %error.code, client = %session.id, "observer error notification had no subscribers")
            }
            Ok(_) => {}
            Err((recipients, errors)) => {
                tracing::warn!(code = %error.code, client = %session.id, recipients, failures = errors.len(), "observer error notification had delivery failures");
            }
        }
    }

    pub(super) fn close_after_flush(&self, id: rmqtt::types::Id) {
        let scx = self.scx.clone();
        let task = tokio::spawn(async move {
            tokio::time::sleep(ERROR_NOTIFY_FLUSH).await;
            let mut entry = scx.extends.shared().await.entry(id);
            if let Err(error) = entry.kick(true, true, false).await {
                tracing::debug!(%error, "denial close: session already gone");
            }
        });
        let mut tasks = self.delayed_closes.lock().expect("delayed close task lock");
        tasks.retain(|task| !task.is_finished());
        tasks.push(task);
    }

    pub(super) async fn stop(&self) {
        let tasks =
            std::mem::take(&mut *self.delayed_closes.lock().expect("delayed close task lock"));
        for task in &tasks {
            task.abort();
        }
        for task in tasks {
            let _ = task.await;
        }
    }

    #[cfg(test)]
    pub(super) fn delayed_close_count(&self) -> usize {
        self.delayed_closes.lock().unwrap().len()
    }
}

pub(super) fn denial_iata(error: &ObserverError) -> String {
    if let Some(iata) = error.iata.as_deref().and_then(normalize_denial_iata) {
        return iata;
    }
    extract_topic_iata(error.topic.as_deref()).unwrap_or_else(|| "XXX".to_owned())
}

fn normalize_denial_iata(value: &str) -> Option<String> {
    if value.eq_ignore_ascii_case("test") {
        return Some("test".to_owned());
    }
    let upper = value.to_ascii_uppercase();
    (upper.len() == 3 && upper.bytes().all(|byte| byte.is_ascii_alphabetic())).then_some(upper)
}

pub(super) fn extract_topic_iata(topic: Option<&str>) -> Option<String> {
    let mut parts = topic?.split('/');
    if parts.next() != Some("meshcore") {
        return None;
    }
    let candidate = parts.next()?.trim();
    parts.next()?;
    normalize_denial_iata(candidate)
}
