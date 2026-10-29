//! In-memory MQTT retained-message store, with no implicit topic cap or TTL.
//! A message remains until overwritten, explicitly cleared, expired by an
//! optional MQTT 5 Message Expiry Interval, or the broker process restarts.
use async_trait::async_trait;
use rmqtt::context::ServerContext;
use rmqtt::retain::RetainStorage;
use rmqtt::topic::Topic;
use rmqtt::types::{FromType, Retain, TopicFilter, TopicName};
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use tokio::time::Instant;

#[derive(Clone)]
pub struct RetainedNeighbors {
    inner: Arc<Inner>,
}

struct Inner {
    scx: ServerContext,
    state: Mutex<State>,
}

#[derive(Default)]
struct State {
    entries: HashMap<String, Entry>,
    maximum_entries: usize,
}

#[derive(Clone)]
struct Entry {
    retain: Retain,
    expires_at: Option<Instant>,
}

impl RetainedNeighbors {
    pub fn new(scx: ServerContext) -> Self {
        Self {
            inner: Arc::new(Inner {
                scx,
                state: Mutex::new(State::default()),
            }),
        }
    }

    pub async fn install(&self) {
        *self.inner.scx.extends.retain_mut().await = Box::new(self.clone());
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
        expiry_interval: Option<Duration>,
    ) -> rmqtt::Result<()> {
        // Preserve the existing rule that broker-owned notifications and
        // heartbeat cannot create retained values.
        if !matches!(retain.from.typ(), FromType::Custom | FromType::LastWill) {
            return Ok(());
        }
        let mut state = self.inner.state.lock().await;
        if retain.publish.payload.is_empty() {
            // MQTT 3.1.1 / 5: a retained zero-byte publish deletes the value.
            state.entries.remove::<str>(topic.as_ref());
        } else {
            let expires_at = expiry_interval.map(|period| Instant::now() + period);
            state
                .entries
                .insert(topic.to_string(), Entry { retain, expires_at });
            state.maximum_entries = state.maximum_entries.max(state.entries.len());
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
            .filter(|(topic, entry)| {
                entry.expires_at.is_none_or(|deadline| deadline > now)
                    && filter.matches_str(topic.as_str())
            })
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
            .filter(|(_, entry)| entry.expires_at.is_none_or(|deadline| deadline > now))
            .map(|(topic, entry)| {
                (
                    TopicName::from(topic.clone()),
                    entry.retain.clone(),
                    entry
                        .expires_at
                        .map(|deadline| deadline.saturating_duration_since(now)),
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
            .filter(|entry| entry.expires_at.is_none_or(|deadline| deadline > now))
            .count() as isize
    }

    async fn max(&self) -> isize {
        self.inner.state.lock().await.maximum_entries as isize
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bytes::Bytes;
    use rmqtt::codec::types::QoS;
    use rmqtt::types::{CodecPublish, From, Id, Publish};

    fn client_retain(topic: &str, payload: &'static [u8]) -> Retain {
        Retain {
            msg_id: None,
            from: From::from_custom(Id::from(0, "client".into())),
            publish: Publish::from(CodecPublish {
                dup: false,
                retain: true,
                qos: QoS::AtMostOnce,
                topic: TopicName::from(topic.to_owned()),
                packet_id: None,
                payload: Bytes::from_static(payload),
                properties: None,
            }),
        }
    }

    #[tokio::test]
    async fn retained_values_have_no_implicit_topic_cap_or_ttl() {
        let scx = ServerContext::new().build().await;
        let store = RetainedNeighbors::new(scx);
        for index in 0..10_010 {
            let topic = TopicName::from(format!("meshcore/STO/{index}/status"));
            store
                .set(&topic, client_retain(topic.as_ref(), b"status"), None)
                .await
                .unwrap();
        }
        assert_eq!(store.count().await, 10_010);
        assert_eq!(store.max().await, 10_010);
    }

    #[tokio::test]
    async fn retained_clear_and_replace_follow_standard_mqtt() {
        let scx = ServerContext::new().build().await;
        let store = RetainedNeighbors::new(scx);
        let topic = TopicName::from("meshcore/STO/ABC/status");
        store
            .set(&topic, client_retain(topic.as_ref(), b"old"), None)
            .await
            .unwrap();
        store
            .set(&topic, client_retain(topic.as_ref(), b"new"), None)
            .await
            .unwrap();
        let filter = TopicFilter::from("meshcore/STO/ABC/status");
        assert_eq!(
            store.get(&filter).await.unwrap()[0].1.publish.payload,
            Bytes::from_static(b"new")
        );
        store
            .set(&topic, client_retain(topic.as_ref(), b""), None)
            .await
            .unwrap();
        assert!(store.get(&filter).await.unwrap().is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn mqtt_five_explicit_message_expiry_is_respected() {
        let scx = ServerContext::new().build().await;
        let store = RetainedNeighbors::new(scx);
        let topic = TopicName::from("meshcore/STO/ABC/status");
        let filter = TopicFilter::from("meshcore/STO/ABC/status");
        store
            .set(
                &topic,
                client_retain(topic.as_ref(), b"value"),
                Some(Duration::from_secs(5)),
            )
            .await
            .unwrap();
        assert_eq!(store.count().await, 1);
        tokio::time::advance(Duration::from_secs(6)).await;
        assert_eq!(store.count().await, 0);
        assert!(store.get(&filter).await.unwrap().is_empty());
    }
}
