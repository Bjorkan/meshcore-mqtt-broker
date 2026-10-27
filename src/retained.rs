use async_trait::async_trait;
use bytes::Bytes;
use rmqtt::codec::types::QoS;
use rmqtt::context::ServerContext;
use rmqtt::retain::RetainStorage;
use rmqtt::topic::Topic;
use rmqtt::types::{Retain, TopicFilter, TopicName};
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Mutex, Notify};
use tokio::task::JoinHandle;
use tokio::time::Instant;

pub const RETAINED_NEIGHBOR_CAPACITY: usize = 10_000;
pub const NEIGHBOR_RETENTION: Duration = Duration::from_secs(48 * 60 * 60);

#[derive(Clone)]
pub struct RetainedNeighbors {
    inner: Arc<Inner>,
}

struct Inner {
    scx: ServerContext,
    operations: Mutex<()>,
    state: Mutex<State>,
    changed: Notify,
    capacity: usize,
    retention: Duration,
}

#[derive(Default)]
struct State {
    entries: HashMap<String, Entry>,
    lru_clock: u64,
    maximum_entries: usize,
}

struct Entry {
    retain: Retain,
    expires_at: Instant,
    lru: u64,
}

impl RetainedNeighbors {
    pub fn new(scx: ServerContext, capacity: usize, retention: Duration) -> Self {
        assert!(capacity > 0, "retained capacity must be positive");
        assert!(!retention.is_zero(), "retained TTL must be positive");
        Self {
            inner: Arc::new(Inner {
                scx,
                operations: Mutex::new(()),
                state: Mutex::new(State::default()),
                changed: Notify::new(),
                capacity,
                retention,
            }),
        }
    }

    pub async fn install(&self) {
        *self.inner.scx.extends.retain_mut().await = Box::new(self.clone());
    }

    pub fn spawn_expiry(&self) -> JoinHandle<()> {
        let store = self.clone();
        tokio::spawn(async move { store.expiry_loop().await })
    }

    async fn expiry_loop(self) {
        loop {
            let deadline = {
                let state = self.inner.state.lock().await;
                state.entries.values().map(|entry| entry.expires_at).min()
            };

            match deadline {
                Some(deadline) => {
                    tokio::select! {
                        _ = tokio::time::sleep_until(deadline) => {}
                        _ = self.inner.changed.notified() => continue,
                    }
                }
                None => {
                    self.inner.changed.notified().await;
                    continue;
                }
            }

            let _operation = self.inner.operations.lock().await;
            let expired = {
                let now = Instant::now();
                let mut state = self.inner.state.lock().await;
                let topics = state
                    .entries
                    .iter()
                    .filter(|(_, entry)| entry.expires_at <= now)
                    .map(|(topic, _)| topic.clone())
                    .collect::<Vec<_>>();
                topics
                    .into_iter()
                    .filter_map(|topic| {
                        state
                            .entries
                            .remove(&topic)
                            .map(|entry| (topic, entry.retain))
                    })
                    .collect::<Vec<_>>()
            };

            for (topic, retain) in expired {
                self.forward_clear(&topic, retain).await;
            }
        }
    }

    async fn forward_clear(&self, topic: &str, retain: Retain) {
        let mut publish = retain.publish;
        publish.topic = TopicName::from(topic.to_owned());
        publish.payload = Bytes::new();
        publish.qos = QoS::AtMostOnce;
        publish.retain = true;
        publish.dup = false;
        publish.packet_id = None;
        publish.properties = None;
        if let Err((_, errors)) = self
            .inner
            .scx
            .extends
            .shared()
            .await
            .forwards(None, retain.from, publish)
            .await
        {
            tracing::warn!(
                topic,
                failures = errors.len(),
                "retained neighbor clear had delivery failures"
            );
        }
    }

    async fn store(&self, topic: &str, retain: Retain) -> Option<(String, Retain)> {
        let mut state = self.inner.state.lock().await;
        state.lru_clock = state.lru_clock.wrapping_add(1);
        let lru = state.lru_clock;

        let evicted =
            if !state.entries.contains_key(topic) && state.entries.len() >= self.inner.capacity {
                let oldest = state
                    .entries
                    .iter()
                    .min_by_key(|(_, entry)| entry.lru)
                    .map(|(topic, _)| topic.clone());
                oldest.and_then(|oldest| {
                    state
                        .entries
                        .remove(&oldest)
                        .map(|entry| (oldest, entry.retain))
                })
            } else {
                None
            };

        state.entries.insert(
            topic.to_owned(),
            Entry {
                retain,
                expires_at: Instant::now() + self.inner.retention,
                lru,
            },
        );
        state.maximum_entries = state.maximum_entries.max(state.entries.len());
        drop(state);
        self.inner.changed.notify_one();
        evicted
    }
}

#[async_trait]
impl RetainStorage for RetainedNeighbors {
    fn enable(&self) -> bool {
        true
    }

    fn need_sync(&self) -> bool {
        false
    }

    async fn set(
        &self,
        topic: &TopicName,
        retain: Retain,
        _expiry_interval: Option<Duration>,
    ) -> rmqtt::Result<()> {
        if !retain.from.is_custom() {
            tracing::warn!(topic = %topic, source = %retain.from.typ(), "ignored non-client retained publish");
            return Ok(());
        }
        let _operation = self.inner.operations.lock().await;
        if retain.publish.payload.is_empty() {
            self.inner
                .state
                .lock()
                .await
                .entries
                .remove::<str>(topic.as_ref());
            self.inner.changed.notify_one();
            return Ok(());
        }
        if !is_exact_neighbors_topic(topic.as_ref()) {
            tracing::warn!(topic = %topic, "ignored unexpected non-neighbor retained publish");
            return Ok(());
        }
        if let Some((topic, evicted)) = self.store(topic.as_ref(), retain).await {
            self.forward_clear(&topic, evicted).await;
        }
        Ok(())
    }

    async fn get(&self, topic_filter: &TopicFilter) -> rmqtt::Result<Vec<(TopicName, Retain)>> {
        let filter = Topic::from_str(topic_filter.as_ref())?;
        let now = Instant::now();
        let state = self.inner.state.lock().await;
        Ok(state
            .entries
            .iter()
            .filter(|(topic, entry)| entry.expires_at > now && filter.matches_str(topic.as_str()))
            .map(|(topic, entry)| (TopicName::from(topic.clone()), entry.retain.clone()))
            .collect())
    }

    async fn get_all_paginated(
        &self,
        offset: usize,
        limit: usize,
    ) -> rmqtt::Result<(Vec<(TopicName, Retain, Option<Duration>)>, bool)> {
        let now = Instant::now();
        let state = self.inner.state.lock().await;
        let mut entries = state
            .entries
            .iter()
            .filter(|(_, entry)| entry.expires_at > now)
            .map(|(topic, entry)| {
                (
                    TopicName::from(topic.clone()),
                    entry.retain.clone(),
                    Some(entry.expires_at.saturating_duration_since(now)),
                )
            })
            .collect::<Vec<_>>();
        entries.sort_by(|left, right| left.0.cmp(&right.0));
        let has_more = offset.saturating_add(limit) < entries.len();
        Ok((
            entries.into_iter().skip(offset).take(limit).collect(),
            has_more,
        ))
    }

    async fn count(&self) -> isize {
        let now = Instant::now();
        self.inner
            .state
            .lock()
            .await
            .entries
            .values()
            .filter(|entry| entry.expires_at > now)
            .count() as isize
    }

    async fn max(&self) -> isize {
        self.inner.state.lock().await.maximum_entries as isize
    }
}

pub fn is_exact_neighbors_topic(topic: &str) -> bool {
    let parts = topic.split('/').collect::<Vec<_>>();
    parts.len() == 4 && parts[0] == "meshcore" && parts[3].eq_ignore_ascii_case("neighbors")
}

#[cfg(test)]
mod tests {
    use super::*;
    use rmqtt::types::{CodecPublish, From, Id, Publish};

    #[test]
    fn only_exact_neighbors_topics_are_retained() {
        assert!(is_exact_neighbors_topic("meshcore/STO/ABC/neighbors"));
        assert!(is_exact_neighbors_topic("meshcore/test/ABC/NEIGHBORS"));
        assert!(!is_exact_neighbors_topic(
            "meshcore/STO/ABC/vendor/neighbors"
        ));
        assert!(!is_exact_neighbors_topic(
            "meshcore/STO/ABC/neighbors/extra"
        ));
        assert!(!is_exact_neighbors_topic("other/STO/ABC/neighbors"));
    }

    #[tokio::test]
    async fn last_will_cannot_create_retained_neighbors() {
        let scx = ServerContext::new().build().await;
        let store = RetainedNeighbors::new(scx, 10, Duration::from_secs(60));
        let topic = TopicName::from("meshcore/STO/ABC/neighbors");
        let publish = Publish::from(CodecPublish {
            dup: false,
            retain: true,
            qos: QoS::AtMostOnce,
            topic: topic.clone(),
            packet_id: None,
            payload: Bytes::from_static(b"must-not-be-retained"),
            properties: None,
        });
        let retain = Retain {
            msg_id: None,
            from: From::from_lastwill(Id::from(0, "will-client".into())),
            publish,
        };

        store.set(&topic, retain, None).await.unwrap();
        assert_eq!(store.count().await, 0);
    }
}
