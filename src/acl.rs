use crate::auth::Principal;
use crate::config::{Config, SubscriberRole};
use crate::error::{ObserverError, ObserverErrorCode as Code};

const SERIAL_MAX_BYTES: usize = 4096;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AllowedPublish {
    pub topic: String,
    pub retain: bool,
}

#[derive(Clone, Debug)]
struct MeshcoreTopic<'a> {
    iata: &'a str,
    public_key: &'a str,
    subtopic: &'a str,
}

pub fn authorize_publish(
    config: &Config,
    principal: &Principal,
    connection_id: &str,
    owns_observer: bool,
    topic: &str,
    payload: &[u8],
) -> Result<AllowedPublish, ObserverError> {
    match principal {
        Principal::Subscriber {
            role: SubscriberRole::Admin,
            ..
        } => {
            let parsed = parse_topic(topic).ok_or_else(|| denied(Code::PublishBadTopicShape, "serial/commands topic must be meshcore/<allowed-IATA>/<PUBKEY>/serial/commands.", topic))?;
            if !parsed.subtopic.eq_ignore_ascii_case("serial/commands")
                || !config
                    .allowed_iata
                    .contains(&parsed.iata.to_ascii_uppercase())
            {
                return Err(denied(
                    Code::PublishBadTopicShape,
                    "serial/commands topic must be meshcore/<allowed-IATA>/<PUBKEY>/serial/commands.",
                    topic,
                ));
            }
            if payload.len() > SERIAL_MAX_BYTES {
                return Err(denied(
                    Code::PublishPayloadTooLarge,
                    format!(
                        "serial/commands payload of {} bytes exceeds {SERIAL_MAX_BYTES} bytes.",
                        payload.len()
                    ),
                    topic,
                ));
            }
            Ok(AllowedPublish {
                topic: normalize_topic(&parsed),
                retain: false,
            })
        }
        Principal::Subscriber { .. } => Err(denied(
            Code::PublishReservedSubtopic,
            "Subscriber clients are subscribe-only.",
            topic,
        )),
        Principal::Publisher { public_key } => authorize_observer(
            config,
            public_key,
            connection_id,
            owns_observer,
            topic,
            payload,
        ),
    }
}

fn authorize_observer(
    config: &Config,
    public_key: &str,
    _connection_id: &str,
    owns_observer: bool,
    topic: &str,
    payload: &[u8],
) -> Result<AllowedPublish, ObserverError> {
    if !topic.starts_with("meshcore/") {
        return Err(denied(
            Code::PublishNotMeshcoreTopic,
            "Publishers can only publish to meshcore/<IATA>/<PUBKEY>/<subtopic>.",
            topic,
        ));
    }
    let parsed = parse_topic(topic).ok_or_else(|| denied(Code::PublishBadTopicShape, "Topic must be meshcore/<IATA>/<64-hex-PUBKEY>/<subtopic> without empty segments or wildcards.", topic))?;
    if parsed.iata == "XXX" {
        return Err(denied_iata(Code::PublishPlaceholderIata, "XXX is a placeholder - configure the observer's actual three-letter IATA location code.", topic, parsed.iata).close());
    }
    let is_test = parsed.iata == "test";
    if is_test && !config.allow_test_ingress {
        return Err(denied_iata(
            Code::PublishTestIngressDisabled,
            "Test MQTT ingress is disabled on this broker.",
            topic,
            parsed.iata,
        ));
    }
    if !is_test {
        if parsed.iata.len() != 3 || !parsed.iata.bytes().all(|v| v.is_ascii_uppercase()) {
            return Err(denied_iata(
                Code::PublishInvalidIataFormat,
                format!(
                    "IATA ingress must be exactly three uppercase letters, got {:?}.",
                    parsed.iata
                ),
                topic,
                parsed.iata,
            )
            .close());
        }
        if let Some(primary) = config.secondary_iata.get(parsed.iata) {
            return Err(denied_iata(
                Code::PublishSecondaryIata,
                format!(
                    "IATA {} is a secondary code; publish under its primary code {primary}.",
                    parsed.iata
                ),
                topic,
                parsed.iata,
            ));
        }
        if !config.allowed_iata.contains(parsed.iata) {
            return Err(denied_iata(
                Code::PublishUnknownIata,
                format!("IATA {} is not allowed on this broker.", parsed.iata),
                topic,
                parsed.iata,
            ));
        }
    }
    if !parsed.public_key.eq_ignore_ascii_case(public_key) {
        return Err(denied(
            Code::PublishKeyMismatch,
            "Public key in topic must match the authenticated public key.",
            topic,
        )
        .close());
    }
    if !owns_observer {
        return Err(denied(
            Code::PublishStaleConnection,
            "A newer connection owns this observer public key. Reconnect to take over.",
            topic,
        )
        .close());
    }
    let subtopic = parsed.subtopic.to_ascii_lowercase();
    let root = subtopic.split('/').next().unwrap_or_default();
    if subtopic == "error"
        || subtopic.starts_with("error/")
        || root == "internal"
        || subtopic == "serial/commands"
        || root == "raw"
        || root == "serial" && subtopic != "serial/responses"
    {
        return Err(denied(
            Code::PublishReservedSubtopic,
            "The requested subtopic is broker-owned or reserved.",
            topic,
        ));
    }
    if subtopic == "serial/responses" {
        if payload.len() > SERIAL_MAX_BYTES {
            return Err(denied(
                Code::PublishPayloadTooLarge,
                format!(
                    "serial/responses payload of {} bytes exceeds {SERIAL_MAX_BYTES} bytes.",
                    payload.len()
                ),
                topic,
            ));
        }
        let text = std::str::from_utf8(payload).unwrap_or_default();
        let parts: Vec<&str> = text.split('.').collect();
        if parts.len() != 3
            || parts.iter().any(|part| {
                part.is_empty()
                    || !part
                        .bytes()
                        .all(|v| v.is_ascii_alphanumeric() || v == b'_' || v == b'-')
            })
        {
            return Err(denied(
                Code::PublishSerialResponseInvalid,
                "serial/responses payload must contain three base64url JWT parts.",
                topic,
            ));
        }
        return Ok(AllowedPublish {
            topic: normalize_topic(&parsed),
            retain: false,
        });
    }
    if payload.len() > config.json_publish_max_bytes {
        return Err(denied(
            Code::PublishPayloadTooLarge,
            format!(
                "JSON publish of {} bytes exceeds {} bytes.",
                payload.len(),
                config.json_publish_max_bytes
            ),
            topic,
        ));
    }
    let value: serde_json::Value = serde_json::from_slice(payload).map_err(|_| {
        denied(
            Code::PublishInvalidJson,
            "Payload must be a JSON object with origin_id matching the authenticated public key.",
            topic,
        )
    })?;
    let object = value.as_object().ok_or_else(|| {
        denied(
            Code::PublishInvalidJson,
            "Payload must be a JSON object with origin_id matching the authenticated public key.",
            topic,
        )
    })?;
    let origin = object.get("origin_id").ok_or_else(|| {
        denied(
            Code::PublishOriginMissing,
            "Message must contain origin_id matching the authenticated public key.",
            topic,
        )
    })?;
    if origin.is_null() || origin.as_str() == Some("") {
        return Err(denied(
            Code::PublishOriginMissing,
            "Message must contain origin_id matching the authenticated public key.",
            topic,
        ));
    }
    if !origin
        .as_str()
        .is_some_and(|v| v.eq_ignore_ascii_case(public_key))
    {
        return Err(denied(
            Code::PublishOriginMismatch,
            "origin_id must be a string matching the authenticated public key.",
            topic,
        ));
    }
    Ok(AllowedPublish {
        topic: normalize_topic(&parsed),
        retain: subtopic == "neighbors",
    })
}

pub fn authorize_subscribe(
    config: &Config,
    principal: &Principal,
    topic: &str,
) -> Result<(), ObserverError> {
    match principal {
        Principal::Publisher { public_key } => {
            let stripped = topic
                .strip_suffix("/#")
                .or_else(|| topic.strip_suffix("/+"))
                .unwrap_or(topic);
            let parsed = parse_topic(stripped).ok_or_else(|| {
                denied(
                    Code::PublishReservedSubtopic,
                    "Observers can only subscribe to their own error and serial/commands topics.",
                    topic,
                )
            })?;
            if !parsed.public_key.eq_ignore_ascii_case(public_key) {
                return Err(denied(
                    Code::PublishReservedSubtopic,
                    "Observers can only subscribe to their own topics.",
                    topic,
                ));
            }
            let sub = parsed.subtopic.to_ascii_lowercase();
            if sub == "error" || sub.starts_with("error/") {
                return Ok(());
            }
            if sub == "serial/commands"
                && config
                    .allowed_iata
                    .contains(&parsed.iata.to_ascii_uppercase())
            {
                return Ok(());
            }
            Err(denied(
                Code::PublishReservedSubtopic,
                "Observers can only subscribe to their own error and serial/commands topics.",
                topic,
            ))
        }
        Principal::Subscriber {
            role: SubscriberRole::Admin,
            ..
        } => Ok(()),
        Principal::Subscriber { .. } => {
            let public =
                topic == "meshcore/#" || topic.starts_with("meshcore/") && !is_private_topic(topic);
            if public || topic == "heartbeat/" {
                Ok(())
            } else {
                Err(denied(
                    Code::PublishReservedSubtopic,
                    "Only public meshcore topics and heartbeat are available for this role.",
                    topic,
                ))
            }
        }
    }
}

fn parse_topic(topic: &str) -> Option<MeshcoreTopic<'_>> {
    if topic.contains(['#', '+']) {
        return None;
    }
    let mut parts = topic.split('/');
    if parts.next()? != "meshcore" {
        return None;
    }
    let iata = parts.next()?;
    let public_key = parts.next()?;
    let rest: Vec<&str> = parts.collect();
    if iata.is_empty()
        || public_key.len() != 64
        || !public_key.bytes().all(|v| v.is_ascii_hexdigit())
        || rest.is_empty()
        || rest.iter().any(|v| v.is_empty())
    {
        return None;
    }
    Some(MeshcoreTopic {
        iata,
        public_key,
        subtopic: &topic[("meshcore/".len() + iata.len() + 1 + public_key.len() + 1)..],
    })
}
fn normalize_topic(parsed: &MeshcoreTopic<'_>) -> String {
    format!(
        "meshcore/{}/{}/{}",
        if parsed.iata == "test" {
            "test".into()
        } else {
            parsed.iata.to_ascii_uppercase()
        },
        parsed.public_key.to_ascii_uppercase(),
        parsed.subtopic
    )
}
fn denied(code: Code, message: impl Into<String>, topic: &str) -> ObserverError {
    ObserverError::new(code, message).topic(topic)
}
fn denied_iata(code: Code, message: impl Into<String>, topic: &str, iata: &str) -> ObserverError {
    denied(code, message, topic).iata(iata)
}
fn is_private_topic(topic: &str) -> bool {
    let lower = topic.to_ascii_lowercase();
    lower.contains("/internal")
        || lower.contains("/serial/")
        || lower.ends_with("/error")
        || lower.contains("/error/")
        || topic.starts_with("$SYS/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{HashMap, HashSet};
    use std::net::SocketAddr;
    fn cfg() -> Config {
        Config {
            listener: "127.0.0.1:0".parse::<SocketAddr>().unwrap(),
            ws_max_payload_bytes: 65536,
            json_publish_max_bytes: 8192,
            broker_name: "x".into(),
            expected_audience: "".into(),
            token_max_age_seconds: 0,
            subscribers: HashMap::new(),
            allowed_iata: HashSet::from(["STO".into()]),
            secondary_iata: HashMap::from([("ARN".into(), "STO".into())]),
            allow_test_ingress: false,
        }
    }
    const KEY: &str = "4852B69364572B52EFA1B6BB3E6D0ABED4F389A1CBFBB60A9BBA2CCE649CAF0E";
    fn body() -> Vec<u8> {
        format!(r#"{{"origin_id":"{KEY}"}}"#).into_bytes()
    }
    #[test]
    fn observer_acl_accepts_and_forces_neighbors_retained() {
        let value = authorize_publish(
            &cfg(),
            &Principal::Publisher {
                public_key: KEY.into(),
            },
            "c",
            true,
            &format!("meshcore/STO/{KEY}/neighbors"),
            &body(),
        )
        .unwrap();
        assert!(value.retain);
    }
    #[test]
    fn observer_acl_has_stable_denial_codes() {
        let err = authorize_publish(
            &cfg(),
            &Principal::Publisher {
                public_key: KEY.into(),
            },
            "c",
            true,
            &format!("meshcore/ARN/{KEY}/status"),
            &body(),
        )
        .unwrap_err();
        assert_eq!(err.code, Code::PublishSecondaryIata);
    }
}
