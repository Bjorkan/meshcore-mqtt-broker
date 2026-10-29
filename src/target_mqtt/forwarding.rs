use super::connection::RumqttTarget;
use super::{TargetError, TargetSink, TargetStatus};
use crate::config::TargetMqttConfig;
use bytes::Bytes;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

const TARGET_PUBLISH_TIMEOUT: Duration = Duration::from_secs(5);
const TARGET_MAX_PENDING: usize = 1_000;

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
    publish_timeout: Duration,
    max_pending: usize,
    tx: StdMutex<Option<mpsc::Sender<ForwardMessage>>>,
    worker: StdMutex<Option<JoinHandle<()>>>,
}

struct ForwardMessage {
    topic: String,
    payload: Bytes,
    retained: bool,
}

impl TargetBridge {
    pub fn start(config: TargetMqttConfig, client_id: String) -> Result<Option<Self>, TargetError> {
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
            TARGET_PUBLISH_TIMEOUT,
            TARGET_MAX_PENDING,
        )
    }

    pub fn with_limits(
        config: TargetMqttConfig,
        client_id: String,
        sink: Arc<dyn TargetSink>,
        publish_timeout: Duration,
        max_pending: usize,
    ) -> Self {
        assert!(max_pending > 0);
        let (tx, rx) = mpsc::channel(max_pending);
        let bridge = Self {
            inner: Arc::new(Inner {
                config,
                client_id,
                sink,
                dropped: AtomicU64::new(0),
                successful: AtomicU64::new(0),
                pending: AtomicUsize::new(0),
                stopping: AtomicBool::new(false),
                publish_timeout,
                max_pending,
                tx: StdMutex::new(Some(tx)),
                worker: StdMutex::new(None),
            }),
        };
        let worker_bridge = bridge.clone();
        let worker = tokio::spawn(async move { worker_bridge.worker_loop(rx).await });
        *bridge.inner.worker.lock().unwrap() = Some(worker);
        bridge
    }

    pub fn offer_publish(&self, public_key: &str, topic: &str, payload: Bytes) {
        self.offer_publish_with_retain(public_key, topic, payload, false);
    }

    /// Forward the exact MQTT retain flag; no implicit neighbor retention.
    pub fn offer_publish_with_retain(
        &self,
        public_key: &str,
        topic: &str,
        payload: Bytes,
        retained: bool,
    ) {
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
        let Some(tx) = self.inner.tx.lock().unwrap().clone() else {
            self.inner.pending.fetch_sub(1, Ordering::AcqRel);
            self.inner.dropped.fetch_add(1, Ordering::Relaxed);
            return;
        };
        let message = ForwardMessage {
            topic: topic.to_owned(),
            payload,
            retained,
        };
        if tx.try_send(message).is_err() {
            self.inner.pending.fetch_sub(1, Ordering::AcqRel);
            self.inner.dropped.fetch_add(1, Ordering::Relaxed);
        }
    }

    /// A single worker preserves retained and ordinary publish order.
    async fn worker_loop(self, mut rx: mpsc::Receiver<ForwardMessage>) {
        while let Some(message) = rx.recv().await {
            self.forward(message).await;
            self.inner.pending.fetch_sub(1, Ordering::AcqRel);
        }
    }

    async fn forward(&self, message: ForwardMessage) {
        let result = self
            .publish(&message.topic, message.payload, message.retained)
            .await;
        match result {
            Ok(()) => {
                self.inner.successful.fetch_add(1, Ordering::Relaxed);
            }
            Err(error) => {
                self.inner.dropped.fetch_add(1, Ordering::Relaxed);
                tracing::warn!(topic = %message.topic, %error, "target MQTT forward dropped");
            }
        }
    }

    async fn publish(&self, topic: &str, payload: Bytes, retain: bool) -> Result<(), TargetError> {
        self.ensure_ready()?;
        tokio::time::timeout(
            self.inner.publish_timeout,
            self.inner.sink.publish(topic, payload, retain),
        )
        .await
        .map_err(|_| TargetError::Timeout)?
    }

    fn ensure_ready(&self) -> Result<(), TargetError> {
        if self.inner.stopping.load(Ordering::Acquire) || !self.inner.sink.connected() {
            Err(TargetError::NotReady)
        } else {
            Ok(())
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
        // Close the queue and drain: the worker processes every offered
        // message in order before exiting, bounded by the drain deadline.
        drop(self.inner.tx.lock().unwrap().take());
        let worker = self.inner.worker.lock().unwrap().take();
        if let Some(mut task) = worker
            && tokio::time::timeout(Duration::from_secs(5), &mut task)
                .await
                .is_err()
        {
            tracing::warn!("target MQTT worker did not drain within 5 s; aborting");
            task.abort();
            let _ = task.await;
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
    use async_trait::async_trait;
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
        async fn publish(
            &self,
            topic: &str,
            payload: Bytes,
            retain: bool,
        ) -> Result<(), TargetError> {
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
                Err(TargetError::Publish("injected failure".into()))
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
    async fn retention_matches_the_incoming_flag_and_explicit_clear() {
        let sink = Arc::new(FakeSink::default());
        sink.connected.store(true, Ordering::Release);
        let bridge = TargetBridge::with_sink(config(), "test".into(), sink.clone());
        let topic = format!("meshcore/STO/{KEY}/status");
        let neighbor = format!("meshcore/STO/{KEY}/neighbors");
        bridge.offer_publish_with_retain(KEY, &topic, Bytes::from_static(b"old"), true);
        bridge.offer_publish_with_retain(KEY, &topic, Bytes::from_static(b"live"), false);
        bridge.offer_publish_with_retain(KEY, &neighbor, Bytes::from_static(b"neighbor"), false);
        bridge.offer_publish_with_retain(KEY, &topic, Bytes::new(), true);
        settle(&bridge).await;
        {
            let writes = sink.writes.lock().unwrap();
            assert_eq!(writes.len(), 4);
            assert_eq!(
                writes.iter().map(|row| row.2).collect::<Vec<_>>(),
                [true, false, false, true]
            );
            assert!(writes[3].1.is_empty());
        }
        bridge.stop().await;
    }

    #[tokio::test]
    async fn target_does_not_generate_implicit_expiry_or_capacity_clears() {
        let sink = Arc::new(FakeSink::default());
        sink.connected.store(true, Ordering::Release);
        let bridge = TargetBridge::with_limits(
            config(),
            "test".into(),
            sink.clone(),
            Duration::from_secs(1),
            100,
        );
        for iata in ["STO", "MMX", "GOT"] {
            bridge.offer_publish_with_retain(
                KEY,
                &format!("meshcore/{iata}/{KEY}/neighbors"),
                Bytes::from_static(b"retained"),
                true,
            );
        }
        settle(&bridge).await;
        tokio::time::sleep(Duration::from_millis(50)).await;
        {
            let writes = sink.writes.lock().unwrap();
            assert_eq!(writes.len(), 3);
            assert!(
                writes
                    .iter()
                    .all(|(_, payload, retain)| *retain && !payload.is_empty())
            );
        }
        bridge.stop().await;
    }

    #[derive(Default)]
    struct BlockingSink {
        connected: AtomicBool,
    }

    #[async_trait]
    impl TargetSink for BlockingSink {
        fn connected(&self) -> bool {
            self.connected.load(Ordering::Acquire)
        }
        async fn publish(
            &self,
            _topic: &str,
            _payload: Bytes,
            _retain: bool,
        ) -> Result<(), TargetError> {
            std::future::pending::<()>().await;
            unreachable!()
        }
        async fn stop(&self) {}
    }

    #[tokio::test]
    async fn publish_timeout_drops_the_message_and_the_worker_continues() {
        let sink = Arc::new(BlockingSink::default());
        sink.connected.store(true, Ordering::Release);
        let bridge =
            TargetBridge::with_limits(config(), "test".into(), sink, Duration::from_millis(50), 10);
        bridge.offer_publish(
            KEY,
            &format!("meshcore/STO/{KEY}/status"),
            Bytes::from_static(b"{}"),
        );
        bridge.offer_publish(
            KEY,
            &format!("meshcore/STO/{KEY}/packets"),
            Bytes::from_static(b"{}"),
        );
        settle(&bridge).await;
        assert_eq!(bridge.status().dropped_messages, 2);
        assert_eq!(bridge.status().successful_messages, 0);
        bridge.stop().await;
    }

    #[derive(Default)]
    struct GatedSink {
        connected: AtomicBool,
        writes: StdMutex<Vec<(String, Vec<u8>, bool)>>,
        gate: tokio::sync::Notify,
        gated_once: AtomicBool,
    }
    #[async_trait]
    impl TargetSink for GatedSink {
        fn connected(&self) -> bool {
            self.connected.load(Ordering::Acquire)
        }
        async fn publish(
            &self,
            topic: &str,
            payload: Bytes,
            retain: bool,
        ) -> Result<(), TargetError> {
            if !self.gated_once.swap(true, Ordering::AcqRel) {
                self.gate.notified().await;
            }
            self.writes
                .lock()
                .unwrap()
                .push((topic.into(), payload.to_vec(), retain));
            Ok(())
        }
        async fn stop(&self) {}
    }

    #[tokio::test]
    async fn retained_publish_order_matches_offer_order_under_delay() {
        let sink = Arc::new(GatedSink::default());
        sink.connected.store(true, Ordering::Release);
        let bridge = TargetBridge::with_limits(
            config(),
            "test".into(),
            sink.clone(),
            Duration::from_secs(1),
            10,
        );
        let first = format!("meshcore/STO/{KEY}/neighbors");
        let second = format!("meshcore/MMX/{KEY}/neighbors");
        bridge.offer_publish_with_retain(KEY, &first, Bytes::from_static(b"older"), true);
        bridge.offer_publish_with_retain(KEY, &second, Bytes::from_static(b"newer"), true);
        tokio::time::sleep(Duration::from_millis(10)).await;
        // The worker holds the first publish at the gate: the newer publish
        // must wait behind it instead of overtaking it on another task.
        assert!(sink.writes.lock().unwrap().is_empty());
        sink.gate.notify_one();
        settle(&bridge).await;
        {
            let writes = sink.writes.lock().unwrap();
            let topics = writes
                .iter()
                .map(|(topic, _, _)| topic.as_str())
                .collect::<Vec<_>>();
            assert_eq!(topics, [first.as_str(), second.as_str()]);
            assert!(writes.iter().all(|(_, _, retain)| *retain));
        }
        assert_eq!(bridge.status().successful_messages, 2);
        bridge.stop().await;
    }
}
