use bytes::Bytes;
use rmqtt::codec::types::QoS;
use rmqtt::context::ServerContext;
use rmqtt::types::{CodecPublish, From, Id, Publish};
use std::time::Duration;
use tokio::task::JoinHandle;

/// Mirrors the legacy TypeScript `heartbeat.ts`: one broker-originated
/// QoS 0 publish to `heartbeat/` immediately at start, then every 30 s.
pub const BROKER_HEARTBEAT_TOPIC: &str = "heartbeat/";
pub const BROKER_HEARTBEAT_MESSAGE: &str = "Hjärtat slår";
pub const BROKER_HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30);

#[derive(Clone)]
pub struct HeartbeatPublisher {
    scx: ServerContext,
    interval: Duration,
}

impl HeartbeatPublisher {
    pub fn spawn(scx: ServerContext) -> JoinHandle<()> {
        Self {
            scx,
            interval: BROKER_HEARTBEAT_INTERVAL,
        }
        .spawn_task()
    }

    pub fn with_interval(scx: ServerContext, interval: Duration) -> Self {
        Self { scx, interval }
    }

    pub fn spawn_task(&self) -> JoinHandle<()> {
        let publisher = self.clone();
        tokio::spawn(async move { publisher.run().await })
    }

    async fn run(&self) {
        let mut ticker = tokio::time::interval(self.interval);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            // The first tick completes immediately, matching the legacy
            // publish-at-start behavior.
            ticker.tick().await;
            self.publish().await;
        }
    }

    async fn publish(&self) {
        let publish = Publish::from(CodecPublish {
            dup: false,
            retain: false,
            qos: QoS::AtMostOnce,
            topic: BROKER_HEARTBEAT_TOPIC.into(),
            packet_id: None,
            payload: Bytes::from_static(BROKER_HEARTBEAT_MESSAGE.as_bytes()),
            properties: None,
        });
        let from = From::from_system(Id::from(self.scx.node.id(), "heartbeat".into()));
        match self
            .scx
            .extends
            .shared()
            .await
            .forwards(None, from, publish)
            .await
        {
            Ok(recipients) => {
                tracing::debug!(
                    recipients,
                    topic = BROKER_HEARTBEAT_TOPIC,
                    "heartbeat published"
                );
            }
            Err((recipients, errors)) => {
                tracing::warn!(
                    recipients,
                    failures = errors.len(),
                    topic = BROKER_HEARTBEAT_TOPIC,
                    "heartbeat publish had delivery failures"
                );
            }
        }
    }
}
