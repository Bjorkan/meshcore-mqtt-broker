use super::{is_observer_error_topic, is_private_meshcore_topic, parse_meshcore_topic};
use crate::config::SubscriberRole;
use crate::mqtt::auth::Principal;

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

/// Delivery filtering for one subscriber relation. Subscriber roles keep
/// their normal visibility, while a stale observer (whose key now belongs to
/// a newer connection) receives only its own exact `/error` topic so the
/// STALE_CONNECTION notice stays observable. This mirrors the legacy
/// authorizeForward ownership check at every forward.
pub fn delivery_allows(principal: &Principal, topic: &str, is_owner: bool) -> bool {
    match principal {
        Principal::Publisher { public_key } if !is_owner => {
            is_own_observer_error(topic, public_key)
        }
        _ => route_allows(principal, topic),
    }
}

fn is_own_observer_error(topic: &str, public_key: &str) -> bool {
    parse_meshcore_topic(topic).is_some_and(|parsed| {
        parsed.public_key == public_key.to_ascii_uppercase()
            && parsed.subtopic.eq_ignore_ascii_case("error")
    })
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
