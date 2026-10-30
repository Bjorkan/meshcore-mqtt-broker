mod delivery;
mod publish;
mod subscribe;
mod topics;

pub use delivery::{delivery_allows, filter_limited_payload, route_allows};
pub use publish::{AllowedPublish, authorize_publish, authorize_publish_with_retain};
pub use subscribe::authorize_subscribe;
pub use topics::{
    MeshcoreTopic, is_observer_error_topic, is_private_meshcore_topic, parse_meshcore_topic,
};

use crate::mqtt::errors::{ObserverError, ObserverErrorCode as Code};
use topics::normalized_topic;

fn denied(code: Code, message: impl Into<String>, topic: &str) -> ObserverError {
    ObserverError::new(code, message).topic(topic)
}

fn denied_iata(code: Code, message: impl Into<String>, topic: &str, iata: &str) -> ObserverError {
    denied(code, message, topic).iata(iata)
}

/// Build a denial for a successfully parsed topic: the emitted `topic` is the
/// canonical `meshcore/<IATA>/<KEY>/<subtopic>` form and the normalized IATA is
/// attached, matching the TypeScript `denyPublish({ topic, iata })` context.
fn denied_parsed(code: Code, message: impl Into<String>, parsed: &MeshcoreTopic) -> ObserverError {
    ObserverError::new(code, message)
        .topic(normalized_topic(parsed))
        .iata(&parsed.iata)
}

#[cfg(test)]
mod tests {
    use super::publish::{FIRMWARE_NEIGHBORS_JSON_BUFFER_BYTES, SERIAL_MAX_BYTES};
    use super::*;
    use crate::config::{Config, Subscriber, SubscriberRole};
    use crate::mqtt::auth::Principal;
    use std::collections::{HashMap, HashSet};
    use std::net::SocketAddr;

    const KEY: &str = "4852B69364572B52EFA1B6BB3E6D0ABED4F389A1CBFBB60A9BBA2CCE649CAF0E";
    const OTHER_KEY: &str = "0000000000000000000000000000000000000000000000000000000000000000";

    fn config() -> Config {
        Config {
            listener: "127.0.0.1:0".parse::<SocketAddr>().unwrap(),
            trusted_proxies: Vec::new(),
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
    fn publish_retain_flag_is_preserved_for_all_authorized_topics() {
        for subtopic in [
            "neighbors",
            "NEIGHBORS",
            "packets",
            "status",
            "vendor/extension",
            "vendor/neighbors",
            "neighbors/extra",
        ] {
            for retain in [false, true] {
                let allowed = authorize_publish_with_retain(
                    &config(),
                    &publisher(),
                    true,
                    &format!("meshcore/STO/{KEY}/{subtopic}"),
                    &body(),
                    retain,
                )
                .unwrap();
                assert_eq!(allowed.retain, retain, "{subtopic}");
            }
        }
        let cleared = authorize_publish_with_retain(
            &config(),
            &publisher(),
            true,
            &format!("meshcore/STO/{KEY}/status"),
            b"",
            true,
        )
        .unwrap();
        assert!(cleared.retain);
        assert!(
            authorize_publish_with_retain(
                &config(),
                &publisher(),
                true,
                &format!("meshcore/STO/{KEY}/status"),
                b"",
                false,
            )
            .is_err()
        );
    }

    #[test]
    fn denials_attach_normalized_iata_and_canonical_topic() {
        let lowercase_status = format!("meshcore/sto/{}/status", KEY.to_ascii_lowercase());
        let expected_topic = format!("meshcore/STO/{KEY}/status");

        let invalid_json = authorize_publish(
            &config(),
            &publisher(),
            true,
            &lowercase_status,
            b"not json",
        )
        .unwrap_err();
        assert_eq!(invalid_json.code, Code::PublishInvalidJson);
        assert_eq!(invalid_json.iata.as_deref(), Some("STO"));
        assert_eq!(invalid_json.topic.as_deref(), Some(expected_topic.as_str()));

        let origin_missing = authorize_publish(
            &config(),
            &publisher(),
            true,
            &lowercase_status,
            br#"{"no":"origin"}"#,
        )
        .unwrap_err();
        assert_eq!(origin_missing.code, Code::PublishOriginMissing);
        assert_eq!(origin_missing.iata.as_deref(), Some("STO"));
        assert_eq!(
            origin_missing.topic.as_deref(),
            Some(expected_topic.as_str())
        );

        let origin_mismatch = authorize_publish(
            &config(),
            &publisher(),
            true,
            &lowercase_status,
            format!(r#"{{"origin_id":"{OTHER_KEY}"}}"#).as_bytes(),
        )
        .unwrap_err();
        assert_eq!(origin_mismatch.code, Code::PublishOriginMismatch);
        assert_eq!(origin_mismatch.iata.as_deref(), Some("STO"));
        assert_eq!(
            origin_mismatch.topic.as_deref(),
            Some(expected_topic.as_str())
        );

        let reserved = authorize_publish(
            &config(),
            &publisher(),
            true,
            &format!("meshcore/sto/{}/error", KEY.to_ascii_lowercase()),
            &body(),
        )
        .unwrap_err();
        assert_eq!(reserved.code, Code::PublishReservedSubtopic);
        assert_eq!(reserved.iata.as_deref(), Some("STO"));
        assert_eq!(
            reserved.topic.as_deref(),
            Some(format!("meshcore/STO/{KEY}/error").as_str())
        );

        let secondary = authorize_publish(
            &config(),
            &publisher(),
            true,
            &format!("meshcore/arn/{}/packets", KEY.to_ascii_lowercase()),
            &body(),
        )
        .unwrap_err();
        assert_eq!(secondary.code, Code::PublishSecondaryIata);
        assert_eq!(secondary.iata.as_deref(), Some("ARN"));
        assert_eq!(
            secondary.topic.as_deref(),
            Some(format!("meshcore/ARN/{KEY}/packets").as_str())
        );
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
    fn observer_reserved_subscription_flags_close_but_stale_and_bad_iata_do_not() {
        // Subscribing outside the observer's own error/serial topics is the
        // one publisher-subscribe denial the legacy broker closed the socket for.
        let reserved = authorize_subscribe(
            &config(),
            &publisher(),
            true,
            &format!("meshcore/STO/{KEY}/status"),
        )
        .unwrap_err();
        assert_eq!(reserved.code, Code::PublishReservedSubtopic);
        assert!(reserved.close);

        // A replaced observer keeps its socket until it reads its stale notice,
        // and a misconfigured IATA keeps the socket to preserve the error channel.
        let stale = authorize_subscribe(
            &config(),
            &publisher(),
            false,
            &format!("meshcore/STO/{KEY}/error"),
        )
        .unwrap_err();
        assert_eq!(stale.code, Code::PublishStaleConnection);
        assert!(!stale.close);

        let bad_iata = authorize_subscribe(
            &config(),
            &publisher(),
            true,
            &format!("meshcore/ABC/{KEY}/serial/commands"),
        )
        .unwrap_err();
        assert_eq!(bad_iata.code, Code::PublishUnknownIata);
        assert!(!bad_iata.close);
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
