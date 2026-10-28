use crate::auth::Principal;
use crate::config::{Config, SubscriberRole};
use crate::error::{ObserverError, ObserverErrorCode as Code};

const SERIAL_MAX_BYTES: usize = 4_096;
const FIRMWARE_NEIGHBORS_JSON_BUFFER_BYTES: usize = 10_240;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AllowedPublish {
    pub topic: String,
    pub retain: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MeshcoreTopic {
    pub iata: String,
    pub public_key: String,
    pub subtopic: String,
}

pub fn authorize_publish(
    config: &Config,
    principal: &Principal,
    owns_observer: bool,
    topic: &str,
    payload: &[u8],
) -> Result<AllowedPublish, ObserverError> {
    match principal {
        Principal::Subscriber {
            role: SubscriberRole::Admin,
            ..
        } => authorize_admin_publish(config, topic, payload),
        Principal::Subscriber { .. } => Err(denied(
            Code::PublishReservedSubtopic,
            "Subscriber clients are subscribe-only.",
            topic,
        )),
        Principal::Publisher { public_key } => {
            authorize_observer_publish(config, public_key, owns_observer, topic, payload)
        }
    }
}

fn authorize_admin_publish(
    config: &Config,
    topic: &str,
    payload: &[u8],
) -> Result<AllowedPublish, ObserverError> {
    let parsed = parse_meshcore_topic(topic).ok_or_else(|| {
        denied(
            Code::PublishBadTopicShape,
            "serial/commands topic must be meshcore/<allowed-IATA>/<PUBKEY>/serial/commands.",
            topic,
        )
    })?;
    if !parsed.subtopic.eq_ignore_ascii_case("serial/commands")
        || !config.allowed_iata.contains(&parsed.iata)
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
        topic: normalized_topic(&parsed),
        retain: false,
    })
}

fn authorize_observer_publish(
    config: &Config,
    public_key: &str,
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
    let parsed = parse_meshcore_topic(topic).ok_or_else(|| {
        denied(
            Code::PublishBadTopicShape,
            "Topic must be meshcore/<IATA>/<64-hex-PUBKEY>/<subtopic> without empty segments or wildcards.",
            topic,
        )
    })?;

    validate_iata(config, &parsed, topic)?;
    if parsed.public_key != public_key.to_ascii_uppercase() {
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
    if subtopic == "error" || subtopic.starts_with("error/") {
        return Err(denied(
            Code::PublishReservedSubtopic,
            "error is a broker-owned subtopic: subscribe to receive denial codes, do not publish.",
            topic,
        ));
    }
    if root == "internal" {
        return Err(denied(
            Code::PublishReservedSubtopic,
            "internal is a broker-owned subtopic.",
            topic,
        ));
    }
    if subtopic == "serial/commands" {
        return Err(denied(
            Code::PublishReservedSubtopic,
            "serial/commands is admin-only.",
            topic,
        ));
    }
    if root == "serial" && subtopic != "serial/responses" {
        return Err(denied(
            Code::PublishReservedSubtopic,
            format!(
                "Publisher serial subtopic is reserved: {}.",
                parsed.subtopic
            ),
            topic,
        ));
    }
    if root == "raw" {
        return Err(denied(
            Code::PublishReservedSubtopic,
            "raw is deprecated and always discarded: publish raw MeshCore bytes inside /packets JSON instead.",
            topic,
        ));
    }
    if subtopic == "serial/responses" {
        return authorize_serial_response(&parsed, topic, payload);
    }

    let json_limit = if subtopic == "neighbors" {
        config
            .json_publish_max_bytes
            .max(FIRMWARE_NEIGHBORS_JSON_BUFFER_BYTES)
    } else {
        config.json_publish_max_bytes
    };
    if payload.len() > json_limit {
        return Err(denied(
            Code::PublishPayloadTooLarge,
            format!(
                "JSON publish of {} bytes exceeds {json_limit} bytes for {}.",
                payload.len(),
                parsed.subtopic
            ),
            topic,
        ));
    }
    validate_json_origin(payload, public_key, topic)?;
    Ok(AllowedPublish {
        topic: normalized_topic(&parsed),
        retain: subtopic == "neighbors",
    })
}

fn validate_iata(
    config: &Config,
    parsed: &MeshcoreTopic,
    topic: &str,
) -> Result<(), ObserverError> {
    if parsed.iata == "XXX" {
        return Err(denied_iata(
            Code::PublishPlaceholderIata,
            "XXX is a placeholder - configure the observer's actual three-letter IATA location code in the observer settings.",
            topic,
            &parsed.iata,
        )
        .close());
    }
    if parsed.iata == "test" {
        return if config.allow_test_ingress {
            Ok(())
        } else {
            Err(denied_iata(
                Code::PublishTestIngressDisabled,
                "Test MQTT ingress is disabled on this broker.",
                topic,
                &parsed.iata,
            ))
        };
    }
    if parsed.iata.len() != 3 || !parsed.iata.bytes().all(|value| value.is_ascii_uppercase()) {
        return Err(denied_iata(
            Code::PublishInvalidIataFormat,
            format!(
                "IATA ingress must be exactly three uppercase letters, got {:?}.",
                parsed.iata
            ),
            topic,
            &parsed.iata,
        )
        .close());
    }
    if let Some(primary) = config.secondary_iata.get(&parsed.iata) {
        return Err(denied_iata(
            Code::PublishSecondaryIata,
            format!("Use primary IATA {primary} for {}", parsed.iata),
            topic,
            &parsed.iata,
        ));
    }
    if !config.allowed_iata.contains(&parsed.iata) {
        let mut allowed = config.allowed_iata.iter().cloned().collect::<Vec<_>>();
        allowed.sort();
        return Err(denied_iata(
            Code::PublishUnknownIata,
            format!(
                "IATA {} is not allowed on this broker (allowed: {}).",
                parsed.iata,
                allowed.join(", ")
            ),
            topic,
            &parsed.iata,
        ));
    }
    Ok(())
}

fn authorize_serial_response(
    parsed: &MeshcoreTopic,
    topic: &str,
    payload: &[u8],
) -> Result<AllowedPublish, ObserverError> {
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
    let parts = text.split('.').collect::<Vec<_>>();
    if parts.len() != 3
        || parts.iter().any(|part| {
            part.is_empty()
                || !part
                    .bytes()
                    .all(|value| value.is_ascii_alphanumeric() || matches!(value, b'_' | b'-'))
        })
    {
        return Err(denied(
            Code::PublishSerialResponseInvalid,
            "serial/responses payload must contain three base64url JWT parts.",
            topic,
        ));
    }
    Ok(AllowedPublish {
        topic: normalized_topic(parsed),
        retain: false,
    })
}

fn validate_json_origin(
    payload: &[u8],
    public_key: &str,
    topic: &str,
) -> Result<(), ObserverError> {
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
        .is_some_and(|value| value.eq_ignore_ascii_case(public_key))
    {
        return Err(denied(
            Code::PublishOriginMismatch,
            "origin_id must be a string matching the authenticated public key.",
            topic,
        ));
    }
    Ok(())
}

pub fn authorize_subscribe(
    config: &Config,
    principal: &Principal,
    owns_observer: bool,
    topic: &str,
) -> Result<(), ObserverError> {
    match principal {
        Principal::Publisher { public_key } => {
            authorize_observer_subscribe(config, public_key, owns_observer, topic)
        }
        Principal::Subscriber {
            role: SubscriberRole::Admin,
            ..
        } => Ok(()),
        Principal::Subscriber { .. } => {
            let public = topic == "meshcore/#"
                || topic.starts_with("meshcore/") && !is_private_meshcore_topic(topic);
            if (public || topic == "heartbeat/") && !topic.starts_with("$SYS/") {
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

fn authorize_observer_subscribe(
    config: &Config,
    public_key: &str,
    owns_observer: bool,
    topic: &str,
) -> Result<(), ObserverError> {
    if !owns_observer {
        return Err(denied(
            Code::PublishStaleConnection,
            "Publisher is not the active observer connection. Reconnect to take over.",
            topic,
        ));
    }
    let stripped = topic
        .strip_suffix("/#")
        .or_else(|| topic.strip_suffix("/+"))
        .unwrap_or(topic);
    let parsed = parse_meshcore_topic(stripped).ok_or_else(|| {
        denied(
            Code::PublishReservedSubtopic,
            "Observers can only subscribe to their own error and serial/commands topics.",
            topic,
        )
    })?;
    if parsed.public_key != public_key.to_ascii_uppercase() {
        return Err(denied(
            Code::PublishReservedSubtopic,
            "Observers can only subscribe to their own topics.",
            topic,
        ));
    }
    let subtopic = parsed.subtopic.to_ascii_lowercase();
    if subtopic == "error" || subtopic.starts_with("error/") {
        return Ok(());
    }
    if subtopic == "serial/commands" {
        return if parsed.iata == "test" && config.allow_test_ingress
            || config.allowed_iata.contains(&parsed.iata)
        {
            Ok(())
        } else {
            Err(denied_iata(
                Code::PublishUnknownIata,
                "serial/commands requires an allowed observer IATA; fix the observer IATA to receive commands.",
                topic,
                &parsed.iata,
            ))
        };
    }
    Err(denied(
        Code::PublishReservedSubtopic,
        "Publisher clients are publish-only; observers can only subscribe to their own error and serial/commands topics.",
        topic,
    ))
}

pub fn parse_meshcore_topic(topic: &str) -> Option<MeshcoreTopic> {
    let parts = topic.split('/').collect::<Vec<_>>();
    if parts.len() < 4
        || parts[0] != "meshcore"
        || parts
            .iter()
            .any(|part| part.trim().is_empty() || part.contains(['+', '#']))
    {
        return None;
    }
    let raw_iata = parts[1].trim();
    let public_key = parts[2].to_ascii_uppercase();
    if public_key.len() != 64 || !public_key.bytes().all(|value| value.is_ascii_hexdigit()) {
        return None;
    }
    Some(MeshcoreTopic {
        iata: if raw_iata.eq_ignore_ascii_case("test") {
            "test".to_owned()
        } else {
            raw_iata.to_ascii_uppercase()
        },
        public_key,
        subtopic: parts[3..].join("/"),
    })
}

pub fn is_private_meshcore_topic(topic: &str) -> bool {
    let parts = topic.split('/').collect::<Vec<_>>();
    parts.len() >= 4
        && parts[0] == "meshcore"
        && matches!(
            parts[3].to_ascii_lowercase().as_str(),
            "internal" | "serial"
        )
}

pub fn is_observer_error_topic(topic: &str) -> bool {
    let parts = topic.split('/').collect::<Vec<_>>();
    parts.len() >= 4
        && parts[0] == "meshcore"
        && parts[3] == "error"
        && parts[2].len() == 64
        && parts[2].bytes().all(|value| value.is_ascii_hexdigit())
}

fn normalized_topic(parsed: &MeshcoreTopic) -> String {
    format!(
        "meshcore/{}/{}/{}",
        parsed.iata, parsed.public_key, parsed.subtopic
    )
}

fn denied(code: Code, message: impl Into<String>, topic: &str) -> ObserverError {
    ObserverError::new(code, message).topic(topic)
}

fn denied_iata(code: Code, message: impl Into<String>, topic: &str, iata: &str) -> ObserverError {
    denied(code, message, topic).iata(iata)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Subscriber;
    use std::collections::{HashMap, HashSet};
    use std::net::SocketAddr;

    const KEY: &str = "4852B69364572B52EFA1B6BB3E6D0ABED4F389A1CBFBB60A9BBA2CCE649CAF0E";
    const OTHER_KEY: &str = "0000000000000000000000000000000000000000000000000000000000000000";

    fn config() -> Config {
        Config {
            listener: "127.0.0.1:0".parse::<SocketAddr>().unwrap(),
            ws_max_payload_bytes: 65_536,
            json_publish_max_bytes: 8_192,
            broker_name: "test".into(),
            expected_audience: "".into(),
            token_max_age_seconds: 0,
            subscribers: HashMap::from([
                (
                    "admin".into(),
                    Subscriber {
                        password: "x".into(),
                        role: SubscriberRole::Admin,
                        max_connections: 1,
                    },
                ),
                (
                    "full".into(),
                    Subscriber {
                        password: "x".into(),
                        role: SubscriberRole::FullAccess,
                        max_connections: 1,
                    },
                ),
            ]),
            allowed_iata: HashSet::from(["STO".into()]),
            secondary_iata: HashMap::from([("ARN".into(), "STO".into())]),
            allow_test_ingress: false,
            target_mqtt: Default::default(),
            meshcore_io: Default::default(),
            healthcheck: crate::config::HealthcheckConfig {
                url: "http://127.0.0.1:8883/status".into(),
                timeout_ms: 8_000,
            },
        }
    }

    fn publisher() -> Principal {
        Principal::Publisher {
            public_key: KEY.into(),
        }
    }

    fn body() -> Vec<u8> {
        format!(r#"{{"origin_id":"{KEY}"}}"#).into_bytes()
    }

    #[test]
    fn iata_is_case_insensitive_and_topics_are_canonicalized() {
        for (iata, expected) in [("sto", "STO"), ("StO", "STO")] {
            let allowed = authorize_publish(
                &config(),
                &publisher(),
                true,
                &format!("meshcore/{iata}/{}/packets", KEY.to_ascii_lowercase()),
                &body(),
            )
            .unwrap();
            assert_eq!(allowed.topic, format!("meshcore/{expected}/{KEY}/packets"));
        }
    }

    #[test]
    fn publish_acceptance_matrix_matches_the_previous_broker() {
        let cases = [
            ("neighbors", true),
            ("NEIGHBORS", true),
            ("packets", false),
            ("status", false),
            ("vendor/extension", false),
            ("vendor/neighbors", false),
            ("neighbors/extra", false),
        ];
        for (subtopic, retained) in cases {
            let allowed = authorize_publish(
                &config(),
                &publisher(),
                true,
                &format!("meshcore/STO/{KEY}/{subtopic}"),
                &body(),
            )
            .unwrap();
            assert_eq!(allowed.retain, retained, "{subtopic}");
        }
    }

    #[test]
    fn publish_denial_matrix_has_the_compatible_codes() {
        let cases = [
            ("other/topic".to_owned(), Code::PublishNotMeshcoreTopic),
            (format!("meshcore/STO/{KEY}"), Code::PublishBadTopicShape),
            (
                format!("meshcore/XXX/{KEY}/packets"),
                Code::PublishPlaceholderIata,
            ),
            (
                format!("meshcore/test/{KEY}/packets"),
                Code::PublishTestIngressDisabled,
            ),
            (
                format!("meshcore/AB/{KEY}/packets"),
                Code::PublishInvalidIataFormat,
            ),
            (
                format!("meshcore/ARN/{KEY}/packets"),
                Code::PublishSecondaryIata,
            ),
            (
                format!("meshcore/ABC/{KEY}/packets"),
                Code::PublishUnknownIata,
            ),
            (
                format!("meshcore/STO/{OTHER_KEY}/packets"),
                Code::PublishKeyMismatch,
            ),
            (
                format!("meshcore/STO/{KEY}/raw"),
                Code::PublishReservedSubtopic,
            ),
            (
                format!("meshcore/STO/{KEY}/internal/x"),
                Code::PublishReservedSubtopic,
            ),
            (
                format!("meshcore/STO/{KEY}/error"),
                Code::PublishReservedSubtopic,
            ),
            (
                format!("meshcore/STO/{KEY}/serial/commands"),
                Code::PublishReservedSubtopic,
            ),
        ];
        for (topic, code) in cases {
            let error =
                authorize_publish(&config(), &publisher(), true, &topic, &body()).unwrap_err();
            assert_eq!(error.code, code, "{topic}");
        }
        let stale = authorize_publish(
            &config(),
            &publisher(),
            false,
            &format!("meshcore/STO/{KEY}/packets"),
            &body(),
        )
        .unwrap_err();
        assert_eq!(stale.code, Code::PublishStaleConnection);
    }

    #[test]
    fn subscriber_role_subscription_matrix_matches_the_previous_broker() {
        let admin = Principal::Subscriber {
            username: "admin".into(),
            role: SubscriberRole::Admin,
        };
        let full = Principal::Subscriber {
            username: "full".into(),
            role: SubscriberRole::FullAccess,
        };
        assert!(authorize_subscribe(&config(), &admin, true, "$SYS/#").is_ok());
        for accepted in [
            "meshcore/#",
            "heartbeat/",
            &format!("meshcore/STO/{KEY}/error"),
        ] {
            assert!(
                authorize_subscribe(&config(), &full, true, accepted).is_ok(),
                "{accepted}"
            );
        }
        for denied_topic in [
            "heartbeat",
            "heartbeat/#",
            "$SYS/#",
            &format!("meshcore/STO/{KEY}/internal/#"),
            &format!("meshcore/STO/{KEY}/serial/#"),
        ] {
            assert!(
                authorize_subscribe(&config(), &full, true, denied_topic).is_err(),
                "{denied_topic}"
            );
        }
    }

    #[test]
    fn observer_subscription_matrix_preserves_error_access_and_ownership() {
        for accepted in [
            format!("meshcore/XXX/{KEY}/error"),
            format!("meshcore/STO/{KEY}/error/#"),
            format!("meshcore/STO/{KEY}/serial/commands"),
        ] {
            assert!(authorize_subscribe(&config(), &publisher(), true, &accepted).is_ok());
        }
        let bad_iata = authorize_subscribe(
            &config(),
            &publisher(),
            true,
            &format!("meshcore/ABC/{KEY}/serial/commands"),
        )
        .unwrap_err();
        assert_eq!(bad_iata.code, Code::PublishUnknownIata);
        let stale = authorize_subscribe(
            &config(),
            &publisher(),
            false,
            &format!("meshcore/STO/{KEY}/error"),
        )
        .unwrap_err();
        assert_eq!(stale.code, Code::PublishStaleConnection);
    }

    #[test]
    fn neighbors_use_the_firmware_json_limit() {
        let payload = format!(
            r#"{{"origin_id":"{KEY}","padding":"{}"}}"#,
            "x".repeat(8_500)
        );
        assert!(
            authorize_publish(
                &config(),
                &publisher(),
                true,
                &format!("meshcore/STO/{KEY}/neighbors"),
                payload.as_bytes(),
            )
            .is_ok()
        );
        assert_eq!(
            authorize_publish(
                &config(),
                &publisher(),
                true,
                &format!("meshcore/STO/{KEY}/packets"),
                payload.as_bytes(),
            )
            .unwrap_err()
            .code,
            Code::PublishPayloadTooLarge
        );
    }

    #[test]
    fn payload_limits_accept_exact_boundary_and_reject_one_byte_more() {
        let config = config();
        for (subtopic, limit) in [
            ("packets", config.json_publish_max_bytes),
            (
                "neighbors",
                config
                    .json_publish_max_bytes
                    .max(FIRMWARE_NEIGHBORS_JSON_BUFFER_BYTES),
            ),
        ] {
            let prefix = format!(r#"{{"origin_id":"{KEY}","padding":""#);
            let suffix = r#""}"#;
            let padding = "x".repeat(limit - prefix.len() - suffix.len());
            let exact = format!("{prefix}{padding}{suffix}");
            assert_eq!(exact.len(), limit);
            assert!(
                authorize_publish(
                    &config,
                    &publisher(),
                    true,
                    &format!("meshcore/STO/{KEY}/{subtopic}"),
                    exact.as_bytes(),
                )
                .is_ok(),
                "{subtopic} exact boundary"
            );
            let too_large = exact.replacen(suffix, &format!("x{suffix}"), 1);
            assert_eq!(too_large.len(), limit + 1);
            assert_eq!(
                authorize_publish(
                    &config,
                    &publisher(),
                    true,
                    &format!("meshcore/STO/{KEY}/{subtopic}"),
                    too_large.as_bytes(),
                )
                .unwrap_err()
                .code,
                Code::PublishPayloadTooLarge
            );
        }

        let exact_serial = format!("{}.b.c", "a".repeat(SERIAL_MAX_BYTES - 4));
        assert_eq!(exact_serial.len(), SERIAL_MAX_BYTES);
        assert!(
            authorize_publish(
                &config,
                &publisher(),
                true,
                &format!("meshcore/STO/{KEY}/serial/responses"),
                exact_serial.as_bytes(),
            )
            .is_ok()
        );
        let too_large_serial = format!("a{exact_serial}");
        assert_eq!(
            authorize_publish(
                &config,
                &publisher(),
                true,
                &format!("meshcore/STO/{KEY}/serial/responses"),
                too_large_serial.as_bytes(),
            )
            .unwrap_err()
            .code,
            Code::PublishPayloadTooLarge
        );
    }
}
