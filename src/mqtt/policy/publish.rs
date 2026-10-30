use super::topics::{MeshcoreTopic, normalized_topic, parse_meshcore_topic};
use super::{denied, denied_parsed};
use crate::config::{Config, SubscriberRole};
use crate::mqtt::auth::Principal;
use crate::mqtt::errors::{ObserverError, ObserverErrorCode as Code};

pub(super) const SERIAL_MAX_BYTES: usize = 4_096;
pub(super) const FIRMWARE_NEIGHBORS_JSON_BUFFER_BYTES: usize = 10_240;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AllowedPublish {
    pub topic: String,
    pub retain: bool,
}

pub fn authorize_publish(
    config: &Config,
    principal: &Principal,
    owns_observer: bool,
    topic: &str,
    payload: &[u8],
) -> Result<AllowedPublish, ObserverError> {
    authorize_publish_with_retain(config, principal, owns_observer, topic, payload, false)
}

/// Pass the MQTT RETAIN flag through instead of choosing it from subtopic.
pub fn authorize_publish_with_retain(
    config: &Config,
    principal: &Principal,
    owns_observer: bool,
    topic: &str,
    payload: &[u8],
    retain: bool,
) -> Result<AllowedPublish, ObserverError> {
    match principal {
        Principal::Subscriber {
            role: SubscriberRole::Admin,
            ..
        } => authorize_admin_publish(config, topic, payload, retain),
        Principal::Subscriber { .. } => Err(denied(
            Code::PublishReservedSubtopic,
            "Subscriber clients are subscribe-only.",
            topic,
        )),
        Principal::Publisher { public_key } => {
            authorize_observer_publish(config, public_key, owns_observer, topic, payload, retain)
        }
    }
}

fn authorize_admin_publish(
    config: &Config,
    topic: &str,
    payload: &[u8],
    retain: bool,
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
        retain,
    })
}

fn authorize_observer_publish(
    config: &Config,
    public_key: &str,
    owns_observer: bool,
    topic: &str,
    payload: &[u8],
    retain: bool,
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

    validate_iata(config, &parsed)?;
    if parsed.public_key != public_key.to_ascii_uppercase() {
        return Err(denied_parsed(
            Code::PublishKeyMismatch,
            "Public key in topic must match the authenticated public key.",
            &parsed,
        )
        .close());
    }
    if !owns_observer {
        return Err(denied_parsed(
            Code::PublishStaleConnection,
            "A newer connection owns this observer public key. Reconnect to take over.",
            &parsed,
        )
        .close());
    }

    let subtopic = parsed.subtopic.to_ascii_lowercase();
    let root = subtopic.split('/').next().unwrap_or_default();
    if subtopic == "error" || subtopic.starts_with("error/") {
        return Err(denied_parsed(
            Code::PublishReservedSubtopic,
            "error is a broker-owned subtopic: subscribe to receive denial codes, do not publish.",
            &parsed,
        ));
    }
    if root == "internal" {
        return Err(denied_parsed(
            Code::PublishReservedSubtopic,
            "internal is a broker-owned subtopic.",
            &parsed,
        ));
    }
    if subtopic == "serial/commands" {
        return Err(denied_parsed(
            Code::PublishReservedSubtopic,
            "serial/commands is admin-only.",
            &parsed,
        ));
    }
    if root == "serial" && subtopic != "serial/responses" {
        return Err(denied_parsed(
            Code::PublishReservedSubtopic,
            format!(
                "Publisher serial subtopic is reserved: {}.",
                parsed.subtopic
            ),
            &parsed,
        ));
    }
    if root == "raw" {
        return Err(denied_parsed(
            Code::PublishReservedSubtopic,
            "raw is deprecated and always discarded: publish raw MeshCore bytes inside /packets JSON instead.",
            &parsed,
        ));
    }
    if subtopic == "serial/responses" {
        return authorize_serial_response(&parsed, payload, retain);
    }

    let json_limit = if subtopic == "neighbors" {
        config
            .json_publish_max_bytes
            .max(FIRMWARE_NEIGHBORS_JSON_BUFFER_BYTES)
    } else {
        config.json_publish_max_bytes
    };
    if payload.len() > json_limit {
        return Err(denied_parsed(
            Code::PublishPayloadTooLarge,
            format!(
                "JSON publish of {} bytes exceeds {json_limit} bytes for {}.",
                payload.len(),
                parsed.subtopic
            ),
            &parsed,
        ));
    }
    // Empty retained payload clears this topic; ownership and topic ACL
    // are checked before this point, so origin_id is not required for clear.
    if !(retain && payload.is_empty()) {
        validate_json_origin(payload, public_key, &parsed)?;
    }
    Ok(AllowedPublish {
        topic: normalized_topic(&parsed),
        retain,
    })
}

fn validate_iata(config: &Config, parsed: &MeshcoreTopic) -> Result<(), ObserverError> {
    if parsed.iata == "XXX" {
        return Err(denied_parsed(
            Code::PublishPlaceholderIata,
            "XXX is a placeholder - configure the observer's actual three-letter IATA location code in the observer settings.",
            parsed,
        )
        .close());
    }
    if parsed.iata == "test" {
        return if config.allow_test_ingress {
            Ok(())
        } else {
            Err(denied_parsed(
                Code::PublishTestIngressDisabled,
                "Test MQTT ingress is disabled on this broker.",
                parsed,
            ))
        };
    }
    if parsed.iata.len() != 3 || !parsed.iata.bytes().all(|value| value.is_ascii_uppercase()) {
        return Err(denied_parsed(
            Code::PublishInvalidIataFormat,
            format!(
                "IATA ingress must be exactly three uppercase letters, got {:?}.",
                parsed.iata
            ),
            parsed,
        )
        .close());
    }
    if let Some(primary) = config.secondary_iata.get(&parsed.iata) {
        return Err(denied_parsed(
            Code::PublishSecondaryIata,
            format!("Use primary IATA {primary} for {}", parsed.iata),
            parsed,
        ));
    }
    if !config.allowed_iata.contains(&parsed.iata) {
        let mut allowed = config.allowed_iata.iter().cloned().collect::<Vec<_>>();
        allowed.sort();
        return Err(denied_parsed(
            Code::PublishUnknownIata,
            format!(
                "IATA {} is not allowed on this broker (allowed: {}).",
                parsed.iata,
                allowed.join(", ")
            ),
            parsed,
        ));
    }
    Ok(())
}

fn authorize_serial_response(
    parsed: &MeshcoreTopic,
    payload: &[u8],
    retain: bool,
) -> Result<AllowedPublish, ObserverError> {
    if payload.is_empty() && retain {
        return Ok(AllowedPublish {
            topic: normalized_topic(parsed),
            retain: true,
        });
    }
    if payload.len() > SERIAL_MAX_BYTES {
        return Err(denied_parsed(
            Code::PublishPayloadTooLarge,
            format!(
                "serial/responses payload of {} bytes exceeds {SERIAL_MAX_BYTES} bytes.",
                payload.len()
            ),
            parsed,
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
        return Err(denied_parsed(
            Code::PublishSerialResponseInvalid,
            "serial/responses payload must contain three base64url JWT parts.",
            parsed,
        ));
    }
    Ok(AllowedPublish {
        topic: normalized_topic(parsed),
        retain,
    })
}

fn validate_json_origin(
    payload: &[u8],
    public_key: &str,
    parsed: &MeshcoreTopic,
) -> Result<(), ObserverError> {
    let value: serde_json::Value = serde_json::from_slice(payload).map_err(|_| {
        denied_parsed(
            Code::PublishInvalidJson,
            "Payload must be a JSON object with origin_id matching the authenticated public key.",
            parsed,
        )
    })?;
    let object = value.as_object().ok_or_else(|| {
        denied_parsed(
            Code::PublishInvalidJson,
            "Payload must be a JSON object with origin_id matching the authenticated public key.",
            parsed,
        )
    })?;
    let origin = object.get("origin_id").ok_or_else(|| {
        denied_parsed(
            Code::PublishOriginMissing,
            "Message must contain origin_id matching the authenticated public key.",
            parsed,
        )
    })?;
    if origin.is_null() || origin.as_str() == Some("") {
        return Err(denied_parsed(
            Code::PublishOriginMissing,
            "Message must contain origin_id matching the authenticated public key.",
            parsed,
        ));
    }
    if !origin
        .as_str()
        .is_some_and(|value| value.eq_ignore_ascii_case(public_key))
    {
        return Err(denied_parsed(
            Code::PublishOriginMismatch,
            "origin_id must be a string matching the authenticated public key.",
            parsed,
        ));
    }
    Ok(())
}
