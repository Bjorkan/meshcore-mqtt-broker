use crate::config::TargetMqttConfig;
use async_trait::async_trait;
use bytes::Bytes;
use rumqttc::{AsyncClient, Event, Incoming, MqttOptions, Outgoing, QoS, Transport};
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::sync::Mutex as StdMutex;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::time::Duration;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

const TARGET_RETAINED_CAPACITY: usize = 10_000;
const TARGET_RETAINED_TTL: Duration = Duration::from_secs(48 * 60 * 60);
const TARGET_PUBLISH_TIMEOUT: Duration = Duration::from_secs(5);
const TARGET_MAX_PENDING: usize = 1_000;
type WriteCompletion = tokio::sync::oneshot::Sender<Result<(), String>>;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TargetStatus {
    pub enabled: bool,
    pub connected: bool,
    pub target_url: Option<String>,
    pub target_host: Option<String>,
    pub client_id: Option<String>,
    pub dropped_messages: u64,
    pub successful_messages: u64,
}

#[async_trait]
pub trait TargetSink: Send + Sync {
    fn connected(&self) -> bool;
    async fn publish(&self, topic: &str, payload: Bytes, retain: bool) -> Result<(), String>;
    async fn stop(&self);
}

struct RumqttTarget {
    client: AsyncClient,
    connected: Arc<AtomicBool>,
    next_write_id: AtomicU64,
    writes: Arc<StdMutex<VecDeque<(u64, WriteCompletion)>>>,
    task: Mutex<Option<JoinHandle<()>>>,
}

impl RumqttTarget {
    fn connect(config: &TargetMqttConfig, client_id: &str) -> Result<Arc<Self>, String> {
        let url = url::Url::parse(&config.url).map_err(|error| error.to_string())?;
        let host = url
            .host_str()
            .ok_or_else(|| "target MQTT URL has no host".to_owned())?;
        let secure = url.scheme() == "mqtts";
        let port = url.port().unwrap_or(if secure { 8_883 } else { 1_883 });
        let mut options = MqttOptions::new(client_id, host, port);
        options.set_clean_session(true);
        options.set_request_channel_capacity(TARGET_MAX_PENDING);
        options.set_keep_alive(Duration::from_secs(30));
        if secure {
            options.set_transport(if config.reject_unauthorized {
                Transport::tls_with_default_config()
            } else {
                insecure_tls_transport()?
            });
        }
        let url_username = percent_decode(url.username());
        let url_password = url.password().map(percent_decode).unwrap_or_default();
        let username = if config.username.is_empty() {
            url_username
        } else {
            config.username.clone()
        };
        let password = if config.password.is_empty() {
            url_password
        } else {
            config.password.clone()
        };
        if !username.is_empty() || !password.is_empty() {
            options.set_credentials(username, password);
        }
        let (client, mut eventloop) = AsyncClient::new(options, TARGET_MAX_PENDING);
        eventloop
            .network_options
            .set_connection_timeout(config.connect_timeout_ms.div_ceil(1_000));
        let connected = Arc::new(AtomicBool::new(false));
        let connected_for_task = connected.clone();
        let writes: Arc<StdMutex<VecDeque<(u64, WriteCompletion)>>> =
            Arc::new(StdMutex::new(VecDeque::new()));
        let writes_for_task = writes.clone();
        let reconnect = Duration::from_millis(config.reconnect_period_ms);
        let task = tokio::spawn(async move {
            loop {
                match eventloop.poll().await {
                    Ok(Event::Incoming(Incoming::ConnAck(_))) => {
                        connected_for_task.store(true, Ordering::Release);
                        tracing::info!("connected to target MQTT broker");
                    }
                    Ok(Event::Outgoing(Outgoing::Publish(_))) => {
                        if let Some((_, complete)) = writes_for_task.lock().unwrap().pop_front() {
                            let _ = complete.send(Ok(()));
                        }
                    }
                    Ok(_) => {}
                    Err(error) => {
                        connected_for_task.store(false, Ordering::Release);
                        let message = error.to_string();
                        for (_, complete) in writes_for_task.lock().unwrap().drain(..) {
                            let _ = complete.send(Err(message.clone()));
                        }
                        tracing::warn!(%error, "target MQTT connection unavailable");
                        if reconnect.is_zero() {
                            break;
                        }
                        tokio::time::sleep(reconnect).await;
                    }
                }
            }
        });
        Ok(Arc::new(Self {
            client,
            connected,
            next_write_id: AtomicU64::new(0),
            writes,
            task: Mutex::new(Some(task)),
        }))
    }
}

#[derive(Debug)]
struct SkipServerVerification(Arc<rumqttc::tokio_rustls::rustls::crypto::CryptoProvider>);

impl rumqttc::tokio_rustls::rustls::client::danger::ServerCertVerifier for SkipServerVerification {
    fn verify_server_cert(
        &self,
        _end_entity: &rumqttc::tokio_rustls::rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rumqttc::tokio_rustls::rustls::pki_types::CertificateDer<'_>],
        _server_name: &rumqttc::tokio_rustls::rustls::pki_types::ServerName<'_>,
        _ocsp: &[u8],
        _now: rumqttc::tokio_rustls::rustls::pki_types::UnixTime,
    ) -> Result<
        rumqttc::tokio_rustls::rustls::client::danger::ServerCertVerified,
        rumqttc::tokio_rustls::rustls::Error,
    > {
        Ok(rumqttc::tokio_rustls::rustls::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &rumqttc::tokio_rustls::rustls::pki_types::CertificateDer<'_>,
        signature: &rumqttc::tokio_rustls::rustls::DigitallySignedStruct,
    ) -> Result<
        rumqttc::tokio_rustls::rustls::client::danger::HandshakeSignatureValid,
        rumqttc::tokio_rustls::rustls::Error,
    > {
        rumqttc::tokio_rustls::rustls::crypto::verify_tls12_signature(
            message,
            cert,
            signature,
            &self.0.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &rumqttc::tokio_rustls::rustls::pki_types::CertificateDer<'_>,
        signature: &rumqttc::tokio_rustls::rustls::DigitallySignedStruct,
    ) -> Result<
        rumqttc::tokio_rustls::rustls::client::danger::HandshakeSignatureValid,
        rumqttc::tokio_rustls::rustls::Error,
    > {
        rumqttc::tokio_rustls::rustls::crypto::verify_tls13_signature(
            message,
            cert,
            signature,
            &self.0.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<rumqttc::tokio_rustls::rustls::SignatureScheme> {
        self.0.signature_verification_algorithms.supported_schemes()
    }
}

fn insecure_tls_transport() -> Result<Transport, String> {
    use rumqttc::tokio_rustls::rustls;
    let provider = Arc::new(rustls::crypto::aws_lc_rs::default_provider());
    let verifier = Arc::new(SkipServerVerification(provider.clone()));
    let config = rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|error| error.to_string())?
        .dangerous()
        .with_custom_certificate_verifier(verifier)
        .with_no_client_auth();
    tracing::warn!(
        "target_mqtt.reject_unauthorized=false disables target TLS certificate verification"
    );
    Ok(Transport::tls_with_config(config.into()))
}

#[async_trait]
impl TargetSink for RumqttTarget {
    fn connected(&self) -> bool {
        self.connected.load(Ordering::Acquire)
    }

    async fn publish(&self, topic: &str, payload: Bytes, retain: bool) -> Result<(), String> {
        let id = self.next_write_id.fetch_add(1, Ordering::Relaxed);
        let (complete, completed) = tokio::sync::oneshot::channel();
        self.writes.lock().unwrap().push_back((id, complete));
        if let Err(error) = self
            .client
            .publish(topic, QoS::AtMostOnce, retain, payload)
            .await
        {
            self.writes
                .lock()
                .unwrap()
                .retain(|(entry, _)| *entry != id);
            return Err(error.to_string());
        }
        completed
            .await
            .map_err(|_| "target event loop stopped before publish callback".to_owned())?
    }

    async fn stop(&self) {
        self.connected.store(false, Ordering::Release);
        for (_, complete) in self.writes.lock().unwrap().drain(..) {
            let _ = complete.send(Err("target bridge stopping".into()));
        }
        let _ = self.client.disconnect().await;
        if let Some(task) = self.task.lock().await.take() {
            task.abort();
        }
    }
}

fn percent_decode(value: &str) -> String {
    url::form_urlencoded::parse(format!("value={value}").as_bytes())
        .next()
        .map(|(_, value)| value.into_owned())
        .unwrap_or_default()
}

#[derive(Clone)]
pub struct TargetBridge {
    inner: Arc<Inner>,
}

struct Inner {
    config: TargetMqttConfig,
    client_id: String,
    sink: Arc<dyn TargetSink>,
    dropped: AtomicU64,
    successful: AtomicU64,
    pending: AtomicUsize,
    stopping: AtomicBool,
    retained: Mutex<RetainedState>,
    retained_operation: Mutex<()>,
    publish_timeout: Duration,
    max_pending: usize,
    retained_capacity: usize,
    retained_ttl: Duration,
    expiry_task: Mutex<Option<JoinHandle<()>>>,
}

#[derive(Default)]
struct RetainedState {
    deadlines: HashMap<String, RetainedDeadline>,
    lru_clock: u64,
}

struct RetainedDeadline {
    expires_at: tokio::time::Instant,
    lru: u64,
}

impl TargetBridge {
    pub fn start(config: TargetMqttConfig, client_id: String) -> Result<Option<Self>, String> {
        if !config.enabled {
            return Ok(None);
        }
        let sink = RumqttTarget::connect(&config, &client_id)?;
        Ok(Some(Self::with_sink(config, client_id, sink)))
    }

    pub fn with_sink(
        config: TargetMqttConfig,
        client_id: String,
        sink: Arc<dyn TargetSink>,
    ) -> Self {
        Self::with_limits(
            config,
            client_id,
            sink,
            TARGET_RETAINED_CAPACITY,
            TARGET_RETAINED_TTL,
            TARGET_PUBLISH_TIMEOUT,
            TARGET_MAX_PENDING,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn with_limits(
        config: TargetMqttConfig,
        client_id: String,
        sink: Arc<dyn TargetSink>,
        retained_capacity: usize,
        retained_ttl: Duration,
        publish_timeout: Duration,
        max_pending: usize,
    ) -> Self {
        assert!(retained_capacity > 0 && max_pending > 0);
        let bridge = Self {
            inner: Arc::new(Inner {
                config,
                client_id,
                sink,
                dropped: AtomicU64::new(0),
                successful: AtomicU64::new(0),
                pending: AtomicUsize::new(0),
                stopping: AtomicBool::new(false),
                retained: Mutex::new(RetainedState::default()),
                retained_operation: Mutex::new(()),
                publish_timeout,
                max_pending,
                retained_capacity,
                retained_ttl,
                expiry_task: Mutex::new(None),
            }),
        };
        let expiry_bridge = bridge.clone();
        let task = tokio::spawn(async move { expiry_bridge.expiry_loop().await });
        if let Ok(mut slot) = bridge.inner.expiry_task.try_lock() {
            *slot = Some(task);
        }
        bridge
    }

    pub fn offer_publish(&self, public_key: &str, topic: &str, payload: Bytes) {
        if !should_forward_to_target(public_key, topic)
            || self.inner.stopping.load(Ordering::Acquire)
        {
            return;
        }
        if !self.inner.sink.connected() {
            self.inner.dropped.fetch_add(1, Ordering::Relaxed);
            return;
        }
        if self
            .inner
            .pending
            .try_update(Ordering::AcqRel, Ordering::Acquire, |pending| {
                (pending < self.inner.max_pending).then_some(pending + 1)
            })
            .is_err()
        {
            self.inner.dropped.fetch_add(1, Ordering::Relaxed);
            return;
        }
        let bridge = self.clone();
        let topic = topic.to_owned();
        tokio::spawn(async move {
            bridge.forward(topic, payload).await;
            bridge.inner.pending.fetch_sub(1, Ordering::AcqRel);
        });
    }

    async fn forward(&self, topic: String, payload: Bytes) {
        let retained =
            exact_subtopic(&topic).is_some_and(|value| value.eq_ignore_ascii_case("neighbors"));
        let result = if retained {
            let _operation = self.inner.retained_operation.lock().await;
            self.forward_retained(&topic, payload).await
        } else {
            self.publish(&topic, payload, false).await
        };
        match result {
            Ok(()) => {
                self.inner.successful.fetch_add(1, Ordering::Relaxed);
            }
            Err(error) => {
                self.inner.dropped.fetch_add(1, Ordering::Relaxed);
                tracing::warn!(topic, %error, "target MQTT forward dropped");
            }
        }
    }

    async fn forward_retained(&self, topic: &str, payload: Bytes) -> Result<(), String> {
        self.ensure_ready()?;
        let evicted = {
            let state = self.inner.retained.lock().await;
            if !state.deadlines.contains_key(topic)
                && state.deadlines.len() >= self.inner.retained_capacity
            {
                state
                    .deadlines
                    .iter()
                    .min_by_key(|(_, deadline)| deadline.lru)
                    .map(|(topic, _)| topic.clone())
            } else {
                None
            }
        };
        if let Some(evicted) = evicted {
            self.publish(&evicted, Bytes::new(), true).await?;
            self.inner.retained.lock().await.deadlines.remove(&evicted);
        }
        {
            let mut state = self.inner.retained.lock().await;
            state.lru_clock = state.lru_clock.wrapping_add(1);
            let lru = state.lru_clock;
            state
                .deadlines
                .entry(topic.to_owned())
                .or_insert(RetainedDeadline {
                    expires_at: tokio::time::Instant::now() + self.inner.retained_ttl,
                    lru,
                });
        }
        self.publish(topic, payload, true).await?;
        let mut state = self.inner.retained.lock().await;
        state.lru_clock = state.lru_clock.wrapping_add(1);
        let lru = state.lru_clock;
        state.deadlines.insert(
            topic.to_owned(),
            RetainedDeadline {
                expires_at: tokio::time::Instant::now() + self.inner.retained_ttl,
                lru,
            },
        );
        Ok(())
    }

    async fn publish(&self, topic: &str, payload: Bytes, retain: bool) -> Result<(), String> {
        self.ensure_ready()?;
        tokio::time::timeout(
            self.inner.publish_timeout,
            self.inner.sink.publish(topic, payload, retain),
        )
        .await
        .map_err(|_| "target publish timed out".to_owned())?
    }

    fn ensure_ready(&self) -> Result<(), String> {
        if self.inner.stopping.load(Ordering::Acquire) || !self.inner.sink.connected() {
            Err("target broker not ready".into())
        } else {
            Ok(())
        }
    }

    async fn expiry_loop(self) {
        let mut interval = tokio::time::interval(Duration::from_secs(30));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            if self.inner.stopping.load(Ordering::Acquire) {
                return;
            }
            if !self.inner.sink.connected() {
                continue;
            }
            let _operation = self.inner.retained_operation.lock().await;
            let now = tokio::time::Instant::now();
            let due = self
                .inner
                .retained
                .lock()
                .await
                .deadlines
                .iter()
                .filter(|(_, deadline)| deadline.expires_at <= now)
                .map(|(topic, _)| topic.clone())
                .collect::<Vec<_>>();
            for topic in due {
                let deadline = self
                    .inner
                    .retained
                    .lock()
                    .await
                    .deadlines
                    .get(&topic)
                    .map(|deadline| deadline.expires_at);
                if deadline.is_some_and(|deadline| deadline <= tokio::time::Instant::now())
                    && self.publish(&topic, Bytes::new(), true).await.is_ok()
                {
                    let mut state = self.inner.retained.lock().await;
                    if state
                        .deadlines
                        .get(&topic)
                        .is_some_and(|current| Some(current.expires_at) == deadline)
                    {
                        state.deadlines.remove(&topic);
                    }
                }
            }
        }
    }

    pub fn status(&self) -> TargetStatus {
        let parsed = url::Url::parse(&self.inner.config.url).ok();
        TargetStatus {
            enabled: true,
            connected: self.inner.sink.connected(),
            target_url: Some(redact_target_url(&self.inner.config.url)),
            target_host: parsed.and_then(|url| url.host_str().map(str::to_owned)),
            client_id: Some(self.inner.client_id.clone()),
            dropped_messages: self.inner.dropped.load(Ordering::Relaxed),
            successful_messages: self.inner.successful.load(Ordering::Relaxed),
        }
    }

    pub async fn stop(&self) {
        if self.inner.stopping.swap(true, Ordering::AcqRel) {
            return;
        }
        if let Some(task) = self.inner.expiry_task.lock().await.take() {
            task.abort();
        }
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        while self.inner.pending.load(Ordering::Acquire) > 0
            && tokio::time::Instant::now() < deadline
        {
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        self.inner.sink.stop().await;
    }
}

pub fn should_forward_to_target(public_key: &str, topic: &str) -> bool {
    let parts = topic.split('/').collect::<Vec<_>>();
    if parts.len() != 4 || parts[0] != "meshcore" {
        return false;
    }
    if !parts[2].eq_ignore_ascii_case(public_key) {
        return false;
    }
    matches!(
        parts[3].to_ascii_lowercase().as_str(),
        "status" | "packets" | "neighbors"
    )
}

fn exact_subtopic(topic: &str) -> Option<&str> {
    let parts = topic.split('/').collect::<Vec<_>>();
    (parts.len() == 4 && parts[0] == "meshcore").then_some(parts[3])
}

pub fn redact_target_url(value: &str) -> String {
    if let Ok(mut url) = url::Url::parse(value) {
        if !url.username().is_empty() {
            let _ = url.set_username("***");
        }
        if url.password().is_some() {
            let _ = url.set_password(Some("***"));
        }
        return url.to_string();
    }
    value.to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    const KEY: &str = "4852B69364572B52EFA1B6BB3E6D0ABED4F389A1CBFBB60A9BBA2CCE649CAF0E";

    #[derive(Default)]
    struct FakeSink {
        connected: AtomicBool,
        writes: StdMutex<Vec<(String, Vec<u8>, bool)>>,
        failures: AtomicUsize,
    }

    #[async_trait]
    impl TargetSink for FakeSink {
        fn connected(&self) -> bool {
            self.connected.load(Ordering::Acquire)
        }
        async fn publish(&self, topic: &str, payload: Bytes, retain: bool) -> Result<(), String> {
            self.writes
                .lock()
                .unwrap()
                .push((topic.into(), payload.to_vec(), retain));
            if self
                .failures
                .try_update(Ordering::AcqRel, Ordering::Acquire, |left| {
                    (left > 0).then(|| left - 1)
                })
                .is_ok()
            {
                Err("failure".into())
            } else {
                Ok(())
            }
        }
        async fn stop(&self) {}
    }

    fn config() -> TargetMqttConfig {
        TargetMqttConfig {
            enabled: true,
            url: "mqtts://user:secret@example.com:8883".into(),
            ..Default::default()
        }
    }

    async fn settle(bridge: &TargetBridge) {
        for _ in 0..100 {
            if bridge.inner.pending.load(Ordering::Acquire) == 0 {
                return;
            }
            tokio::time::sleep(Duration::from_millis(2)).await;
        }
        panic!("target bridge did not settle");
    }

    #[test]
    fn forwarding_policy_is_exact_and_redaction_hides_credentials() {
        for subtopic in ["status", "STATUS", "packets", "neighbors"] {
            assert!(should_forward_to_target(
                KEY,
                &format!("meshcore/STO/{KEY}/{subtopic}")
            ));
        }
        for subtopic in [
            "serial/commands",
            "internal",
            "error",
            "vendor/status",
            "status/extra",
        ] {
            assert!(!should_forward_to_target(
                KEY,
                &format!("meshcore/STO/{KEY}/{subtopic}")
            ));
        }
        let redacted = redact_target_url("mqtts://user:secret@example.com:8883");
        assert!(!redacted.contains("user"));
        assert!(!redacted.contains("secret"));
    }

    #[tokio::test]
    async fn offline_queue_and_publish_results_have_compatible_counters() {
        let sink = Arc::new(FakeSink::default());
        let bridge = TargetBridge::with_sink(config(), "test".into(), sink.clone());
        bridge.offer_publish(
            KEY,
            &format!("meshcore/STO/{KEY}/status"),
            Bytes::from_static(b"{}"),
        );
        assert_eq!(bridge.status().dropped_messages, 1);
        sink.connected.store(true, Ordering::Release);
        bridge.offer_publish(
            KEY,
            &format!("meshcore/STO/{KEY}/status"),
            Bytes::from_static(b"{}"),
        );
        settle(&bridge).await;
        assert_eq!(bridge.status().successful_messages, 1);
        assert_eq!(bridge.status().dropped_messages, 1);
        bridge.stop().await;
    }

    #[tokio::test]
    async fn neighbors_only_retain_and_capacity_clear_is_lru() {
        let sink = Arc::new(FakeSink::default());
        sink.connected.store(true, Ordering::Release);
        let bridge = TargetBridge::with_limits(
            config(),
            "test".into(),
            sink.clone(),
            2,
            Duration::from_secs(60),
            Duration::from_secs(1),
            10,
        );
        for (iata, subtopic) in [
            ("STO", "status"),
            ("STO", "neighbors"),
            ("MMX", "neighbors"),
            ("STO", "neighbors"),
            ("GOT", "neighbors"),
        ] {
            bridge.offer_publish(
                KEY,
                &format!("meshcore/{iata}/{KEY}/{subtopic}"),
                Bytes::from_static(b"{}"),
            );
            settle(&bridge).await;
        }
        {
            let writes = sink.writes.lock().unwrap();
            assert!(!writes[0].2);
            assert!(writes[1].2);
            assert!(writes.iter().any(|(topic, payload, retain)| {
                topic.contains("/MMX/") && payload.is_empty() && *retain
            }));
        }
        assert_eq!(bridge.status().successful_messages, 5);
        bridge.stop().await;
    }

    #[tokio::test]
    async fn failed_capacity_clear_preserves_old_obligation_and_drops_new_publish() {
        let sink = Arc::new(FakeSink::default());
        sink.connected.store(true, Ordering::Release);
        let bridge = TargetBridge::with_limits(
            config(),
            "test".into(),
            sink.clone(),
            1,
            Duration::from_secs(60),
            Duration::from_secs(1),
            10,
        );
        bridge.offer_publish(
            KEY,
            &format!("meshcore/STO/{KEY}/neighbors"),
            Bytes::from_static(b"{}"),
        );
        settle(&bridge).await;
        sink.failures.store(1, Ordering::Release);
        bridge.offer_publish(
            KEY,
            &format!("meshcore/MMX/{KEY}/neighbors"),
            Bytes::from_static(b"{}"),
        );
        settle(&bridge).await;
        assert_eq!(bridge.status().successful_messages, 1);
        assert_eq!(bridge.status().dropped_messages, 1);
        let retained = bridge.inner.retained.lock().await;
        assert!(
            retained
                .deadlines
                .keys()
                .any(|topic| topic.contains("/STO/"))
        );
        assert!(
            !retained
                .deadlines
                .keys()
                .any(|topic| topic.contains("/MMX/"))
        );
        drop(retained);
        bridge.stop().await;
    }
}
