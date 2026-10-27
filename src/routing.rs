use crate::acl::{is_observer_error_topic, is_private_meshcore_topic, parse_meshcore_topic};
use crate::auth::{Principal, principal_from_username};
use crate::config::{Config, SubscriberRole};
use async_trait::async_trait;
use rmqtt::context::ServerContext;
use rmqtt::router::{DefaultRouter, Router};
use rmqtt::types::{
    AllRelationsMap, HashMap, Id, NodeId, Route, SubRelationsMap, SubsSearchParams,
    SubsSearchResult, SubscriptionOptions, TopicName,
};
use rmqtt::utils::Counter;
use std::sync::Arc;

pub struct RoleRouter {
    inner: DefaultRouter,
    config: Arc<Config>,
}

impl RoleRouter {
    pub fn new(scx: ServerContext, config: Arc<Config>) -> Self {
        Self {
            inner: DefaultRouter::new(Some(scx)),
            config,
        }
    }

    fn principal_for_relation(&self, topic_filter: &str, client_id: &str) -> Option<Principal> {
        let username = self
            .inner
            .relations()
            .get(topic_filter)
            .and_then(|relations| {
                relations
                    .get(client_id)
                    .map(|(id, _)| id.username_ref().to_owned())
            })?;
        principal_from_username(&self.config, &username)
    }
}

#[async_trait]
impl Router for RoleRouter {
    async fn add(
        &self,
        topic_filter: &str,
        id: Id,
        opts: SubscriptionOptions,
    ) -> rmqtt::Result<()> {
        self.inner.add(topic_filter, id, opts).await
    }

    async fn remove(&self, topic_filter: &str, id: Id) -> rmqtt::Result<bool> {
        self.inner.remove(topic_filter, id).await
    }

    async fn matches(&self, id: Id, topic: &TopicName) -> rmqtt::Result<SubRelationsMap> {
        let mut matches = self.inner.matches(id, topic).await?;
        for relations in matches.values_mut() {
            relations.retain(|(topic_filter, client_id, _, _, _)| {
                self.principal_for_relation(topic_filter, client_id)
                    .is_some_and(|principal| route_allows(&principal, topic))
            });
        }
        matches.retain(|_, relations| !relations.is_empty());
        Ok(matches)
    }

    async fn is_online(&self, node_id: NodeId, client_id: &str) -> bool {
        self.inner.is_online(node_id, client_id).await
    }

    async fn gets(&self, limit: usize) -> Vec<Route> {
        self.inner.gets(limit).await
    }

    async fn get(&self, topic: &str) -> rmqtt::Result<Vec<Route>> {
        self.inner.get(topic).await
    }

    async fn query_subscriptions(&self, query: &SubsSearchParams) -> Vec<SubsSearchResult> {
        self.inner.query_subscriptions(query).await
    }

    async fn topics_tree(&self) -> usize {
        self.inner.topics_tree().await
    }

    fn topics(&self) -> Counter {
        self.inner.topics()
    }

    fn routes(&self) -> Counter {
        self.inner.routes()
    }

    fn merge_topics(&self, topics: &HashMap<NodeId, Counter>) -> Counter {
        self.inner.merge_topics(topics)
    }

    fn merge_routes(&self, routes: &HashMap<NodeId, Counter>) -> Counter {
        self.inner.merge_routes(routes)
    }

    async fn list_topics(&self, top: usize) -> Vec<String> {
        self.inner.list_topics(top).await
    }

    async fn list_relations(&self, top: usize) -> Vec<serde_json::Value> {
        self.inner.list_relations(top).await
    }

    fn relations(&self) -> &AllRelationsMap {
        self.inner.relations()
    }
}

pub fn route_allows(principal: &Principal, topic: &str) -> bool {
    match principal {
        Principal::Subscriber {
            role: SubscriberRole::Admin,
            ..
        } => true,
        Principal::Subscriber { .. } => {
            topic != "$SYS"
                && !topic.starts_with("$SYS/")
                && !is_private_meshcore_topic(topic)
                && !is_observer_error_topic(topic)
        }
        Principal::Publisher { public_key } => parse_meshcore_topic(topic).is_some_and(|parsed| {
            parsed.public_key == public_key.to_ascii_uppercase()
                && matches!(
                    parsed.subtopic.to_ascii_lowercase().as_str(),
                    "error" | "serial/commands"
                )
        }),
    }
}

pub fn filter_limited_payload(topic: &str, payload: &[u8]) -> Option<Vec<u8>> {
    let parsed = parse_meshcore_topic(topic)?;
    let subtopic = parsed.subtopic.to_ascii_lowercase();
    let mut value: serde_json::Value = serde_json::from_slice(payload).ok()?;
    let object = value.as_object_mut()?;
    let mut filtered = false;

    match subtopic.as_str() {
        "status" => {
            for field in ["stats", "model", "firmware_version"] {
                filtered |= object.remove(field).is_some();
            }
        }
        "packets" => {
            let keys = object
                .keys()
                .filter(|key| matches!(key.to_ascii_lowercase().as_str(), "snr" | "rssi" | "score"))
                .cloned()
                .collect::<Vec<_>>();
            for key in keys {
                filtered |= object.remove(&key).is_some();
            }
        }
        "neighbors" => {
            let neighbors = object
                .get_mut("neighbors")
                .and_then(|value| value.as_array_mut())?;
            for neighbor in neighbors {
                let Some(neighbor) = neighbor.as_object_mut() else {
                    continue;
                };
                let keys = neighbor
                    .keys()
                    .filter(|key| {
                        matches!(key.to_ascii_lowercase().as_str(), "snr" | "rssi" | "score")
                    })
                    .cloned()
                    .collect::<Vec<_>>();
                for key in keys {
                    filtered |= neighbor.remove(&key).is_some();
                }
            }
        }
        _ => return None,
    }

    filtered.then(|| serde_json::to_vec(&value).expect("filtered JSON serializes"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = "4852B69364572B52EFA1B6BB3E6D0ABED4F389A1CBFBB60A9BBA2CCE649CAF0E";

    fn principal(role: SubscriberRole) -> Principal {
        Principal::Subscriber {
            username: "viewer".into(),
            role,
        }
    }

    #[test]
    fn forward_visibility_matches_subscriber_roles() {
        let public = format!("meshcore/STO/{KEY}/packets");
        let internal = format!("meshcore/STO/{KEY}/internal/state");
        let serial = format!("meshcore/STO/{KEY}/serial/commands");
        let error = format!("meshcore/STO/{KEY}/error");
        for role in [SubscriberRole::FullAccess, SubscriberRole::Limited] {
            let subscriber = principal(role);
            assert!(route_allows(&subscriber, &public));
            assert!(!route_allows(&subscriber, &internal));
            assert!(!route_allows(&subscriber, &serial));
            assert!(!route_allows(&subscriber, &error));
            assert!(!route_allows(&subscriber, "$SYS/broker/health"));
        }
        let admin = principal(SubscriberRole::Admin);
        for topic in [&public, &internal, &serial, &error] {
            assert!(route_allows(&admin, topic));
        }
    }

    #[test]
    fn observer_routes_only_own_private_channels() {
        let observer = Principal::Publisher {
            public_key: KEY.into(),
        };
        assert!(route_allows(
            &observer,
            &format!("meshcore/STO/{KEY}/error")
        ));
        assert!(route_allows(
            &observer,
            &format!("meshcore/STO/{KEY}/serial/commands")
        ));
        assert!(!route_allows(
            &observer,
            &format!("meshcore/STO/{KEY}/packets")
        ));
        assert!(!route_allows(
            &observer,
            &format!("meshcore/STO/{}/error", "0".repeat(64))
        ));
    }

    #[test]
    fn limited_role_filters_only_exact_canonical_subtopics() {
        let status = filter_limited_payload(
            &format!("meshcore/STO/{KEY}/STATUS"),
            br#"{"origin_id":"x","stats":{},"model":"m","firmware_version":"1","name":"kept"}"#,
        )
        .unwrap();
        let status: serde_json::Value = serde_json::from_slice(&status).unwrap();
        assert_eq!(status["name"], "kept");
        assert!(status.get("stats").is_none());
        assert!(status.get("model").is_none());
        assert!(status.get("firmware_version").is_none());

        let packets = filter_limited_payload(
            &format!("meshcore/STO/{KEY}/packets"),
            br#"{"SNR":1,"rssi":2,"Score":3,"raw":"kept"}"#,
        )
        .unwrap();
        let packets: serde_json::Value = serde_json::from_slice(&packets).unwrap();
        assert_eq!(packets["raw"], "kept");
        assert_eq!(packets.as_object().unwrap().len(), 1);

        let neighbors = filter_limited_payload(
            &format!("meshcore/STO/{KEY}/neighbors"),
            br#"{"neighbors":[{"id":"kept","snr":1,"RSSI":2,"score":3},"ignored"]}"#,
        )
        .unwrap();
        let neighbors: serde_json::Value = serde_json::from_slice(&neighbors).unwrap();
        assert_eq!(neighbors["neighbors"][0]["id"], "kept");
        assert_eq!(neighbors["neighbors"][0].as_object().unwrap().len(), 1);

        assert!(
            filter_limited_payload(
                &format!("meshcore/STO/{KEY}/vendor/neighbors"),
                br#"{"neighbors":[{"snr":1}]}"#,
            )
            .is_none()
        );
    }
}
