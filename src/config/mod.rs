mod document;
mod environment;
mod iata;
mod types;
mod validation;

pub use types::*;

use document::*;
use environment::{env_bool, env_int, env_string};
use iata::{normalize_iata, validate_friendly_name};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use validation::{
    resolve_expected_audience, resolve_listener, validate_healthcheck, validate_meshcore_io,
    validate_target_mqtt,
};

impl Config {
    pub fn discover() -> Result<Self, ConfigError> {
        if let Ok(path) = std::env::var("MESHCORE_CONFIG") {
            return Self::load(path);
        }
        for path in [
            "config.yaml",
            "/run/configs/meshcore-mqtt-broker-config.yaml",
            "/run/configs/config.yaml",
        ] {
            if Path::new(path).exists() {
                return Self::load(path);
            }
        }
        Err(ConfigError::Invalid("no config.yaml found".into()))
    }

    pub fn load(path: impl AsRef<Path>) -> Result<Self, ConfigError> {
        let path = path.as_ref();
        let text = fs::read_to_string(path).map_err(|source| ConfigError::Read {
            path: path.into(),
            source,
        })?;
        let doc: Document = serde_yaml::from_str(&text).map_err(|source| ConfigError::Parse {
            path: path.into(),
            source,
        })?;

        // Resolve the IATA allowlist the way the legacy loader did:
        // canonical allowed_iata beats legacy allowed_regions, and an
        // explicit iata.allowlist_enabled (or IATA_whitelist) flag wins over
        // the implicit enablement by presence.
        let entries_name = if doc.allowed_iata.is_some() {
            "allowed_iata"
        } else {
            "allowed_regions"
        };
        let allowlist_enabled = match env_bool(&["iata", "allowlist_enabled"])? {
            Some(enabled) => enabled,
            None => match doc.iata.allowlist_enabled {
                Some(enabled) => enabled,
                None if doc.allowed_iata.is_some() => true,
                None => doc.iata_whitelist.unwrap_or(doc.allowed_regions.is_some()),
            },
        };
        if !allowlist_enabled {
            return Err(ConfigError::Invalid(
                "iata.allowlist_enabled must be true".into(),
            ));
        }
        let entries = doc.allowed_iata.or(doc.allowed_regions).ok_or_else(|| {
            ConfigError::Invalid(format!(
                "{entries_name} must be a non-empty list or object when the IATA allowlist is enabled"
            ))
        })?;
        if entries.is_empty() {
            return Err(ConfigError::Invalid(format!(
                "{entries_name} must not be empty when the IATA allowlist is enabled"
            )));
        }

        let ws_port = match env_int(&["mqtt", "ws_port"], 0, 65_535)? {
            Some(port) => port as u16,
            None => doc.mqtt.ws_port.ok_or_else(|| {
                ConfigError::Invalid("Configuration value mqtt.ws_port is missing or empty".into())
            })?,
        };
        let host = env_string(&["mqtt", "host"])
            .or(doc.mqtt.host)
            .ok_or_else(|| {
                ConfigError::Invalid("Configuration value mqtt.host is missing or empty".into())
            })?;
        let listener = resolve_listener(&host, ws_port)?;
        let trusted_proxy_values = env_string(&["mqtt", "trusted_proxies"])
            .map(|value| {
                value
                    .split(',')
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or(doc.mqtt.trusted_proxies);
        let trusted_proxies = trusted_proxy_values
            .into_iter()
            .map(|value| {
                value.parse::<IpNetwork>().map_err(|error| {
                    ConfigError::Invalid(format!(
                        "Configuration value mqtt.trusted_proxies contains {value:?}: {error}"
                    ))
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        let ws_max_payload_bytes =
            match env_int(&["mqtt", "ws_max_payload_bytes"], 1, i64::from(u32::MAX))? {
                Some(value) => value as u32,
                None => doc.mqtt.ws_max_payload_bytes,
            };
        let json_publish_max_bytes =
            match env_int(&["mqtt", "json_publish_max_bytes"], 1, i64::MAX)? {
                Some(value) => value as usize,
                None => doc.mqtt.json_publish_max_bytes,
            };
        if ws_max_payload_bytes == 0 {
            return Err(ConfigError::Invalid(
                "mqtt.ws_max_payload_bytes must be > 0".into(),
            ));
        }
        if json_publish_max_bytes == 0 {
            return Err(ConfigError::Invalid(
                "mqtt.json_publish_max_bytes must be > 0".into(),
            ));
        }
        let token_max_age_seconds = match env_int(&["auth", "token_max_age_seconds"], 0, i64::MAX)?
        {
            Some(value) => value,
            None => doc.auth.token_max_age_seconds,
        };
        if token_max_age_seconds < 0 {
            return Err(ConfigError::Invalid(
                "auth.token_max_age_seconds must be >= 0".into(),
            ));
        }
        let expected_audience = match env_string(&["auth", "expected_audience"]) {
            Some(value) => value,
            None => resolve_expected_audience(doc.auth.expected_audience)?,
        };
        let default_max_connections =
            match env_int(&["subscribers", "default_max_connections"], 1, i64::MAX)? {
                Some(value) => value as usize,
                None => doc.subscribers.default_max_connections.ok_or_else(|| {
                    ConfigError::Invalid(
                    "Configuration value subscribers.default_max_connections is missing or empty"
                        .into(),
                )
                })?,
            };
        let broker_name = env_string(&["broker", "name"]).unwrap_or(doc.broker.name);
        let allow_test_ingress =
            env_bool(&["iata", "allow_test_ingress"])?.unwrap_or(doc.iata.allow_test_ingress);

        let target_mqtt = validate_target_mqtt(doc.target_mqtt)?;
        let meshcore_io = validate_meshcore_io(doc.meshcore_io)?;
        let healthcheck = validate_healthcheck(doc.healthcheck, ws_port)?;

        let mut allowed_iata = HashSet::new();
        let mut secondary_iata = HashMap::new();
        match entries {
            IataAllowlist::List(list) => {
                for raw in list {
                    let primary = normalize_iata(&raw)?;
                    if !allowed_iata.insert(primary.clone()) {
                        return Err(ConfigError::Invalid(format!(
                            "duplicate primary IATA {primary}"
                        )));
                    }
                }
            }
            IataAllowlist::Entries(map) => {
                for (raw, entry) in map {
                    let primary = normalize_iata(&raw)?;
                    if !allowed_iata.insert(primary.clone()) {
                        return Err(ConfigError::Invalid(format!(
                            "duplicate primary IATA {primary}"
                        )));
                    }
                    validate_friendly_name(entry.friendly_name.as_deref(), &raw)?;
                    for raw_secondary in entry.secondary_iata {
                        let secondary = normalize_iata(&raw_secondary)?;
                        if secondary_iata
                            .insert(secondary.clone(), primary.clone())
                            .is_some()
                        {
                            return Err(ConfigError::Invalid(format!(
                                "duplicate secondary IATA {secondary}"
                            )));
                        }
                    }
                }
            }
        }
        if secondary_iata
            .keys()
            .any(|code| allowed_iata.contains(code))
        {
            return Err(ConfigError::Invalid(
                "an IATA code cannot be both primary and secondary".into(),
            ));
        }

        let mut subscribers = HashMap::new();
        let mut subscriber_names = HashSet::new();
        for user in doc.subscribers.users {
            let username = user.username.trim().to_owned();
            let password = user.password.trim().to_owned();
            if username.is_empty() || password.is_empty() {
                return Err(ConfigError::Invalid(
                    "subscriber username/password must not be empty".into(),
                ));
            }
            if username.to_ascii_lowercase().starts_with("v1_") {
                return Err(ConfigError::Invalid(
                    "subscriber username must not start with reserved observer prefix v1_".into(),
                ));
            }
            if !subscriber_names.insert(username.to_ascii_lowercase()) {
                return Err(ConfigError::Invalid(format!(
                    "duplicate subscriber username {username} (case-insensitive)"
                )));
            }
            let role = match user.role {
                1 => SubscriberRole::Admin,
                2 => SubscriberRole::FullAccess,
                3 => SubscriberRole::Limited,
                value => {
                    return Err(ConfigError::Invalid(format!(
                        "subscriber role must be 1, 2 or 3, got {value}"
                    )));
                }
            };
            let max_connections = user.max_connections.unwrap_or(default_max_connections);
            if max_connections == 0 {
                return Err(ConfigError::Invalid(
                    "subscriber max_connections must be > 0".into(),
                ));
            }
            let subscriber = Subscriber {
                password,
                role,
                max_connections,
            };
            subscribers.insert(username, subscriber);
        }

        Ok(Self {
            listener,
            trusted_proxies,
            ws_max_payload_bytes,
            json_publish_max_bytes,
            broker_name,
            expected_audience,
            token_max_age_seconds,
            subscribers,
            allowed_iata,
            secondary_iata,
            allow_test_ingress,
            target_mqtt,
            meshcore_io,
            healthcheck,
        })
    }
}

/// Mirrors the legacy `requiredAudience()` contract: the key must be present,
/// an explicit empty string disables audience validation, a value containing
/// only whitespace is rejected, and any other value is trimmed.
#[cfg(test)]
mod tests {
    use super::*;

    /// Serializes every test that reads configuration, because the env
    /// override test mutates process-wide MESHCORE_* variables.
    static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn write_config(text: &str) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("config.yaml"), text).unwrap();
        dir
    }

    fn minimal_document(auth: &str) -> String {
        format!(
            "mqtt:\n  ws_port: 1883\n  host: 127.0.0.1\n\
             auth:\n{indent}subscribers:\n  default_max_connections: 2\n\
             iata:\n  allowlist_enabled: true\n\
             allowed_iata:\n  STO: {{}}\n",
            indent = auth
                .lines()
                .map(|line| format!("  {line}\n"))
                .collect::<String>(),
        )
    }

    #[test]
    fn expected_audience_requires_the_key_with_empty_string_opt_out() {
        let _lock = ENV_LOCK.lock().unwrap();
        let dir = write_config(&minimal_document("  expected_audience: aud\n"));
        assert_eq!(
            Config::load(dir.path().join("config.yaml"))
                .unwrap()
                .expected_audience,
            "aud"
        );

        // Missing key: a hard config error, never a silent disable.
        let dir = write_config(&minimal_document(""));
        let error = Config::load(dir.path().join("config.yaml")).unwrap_err();
        assert!(
            error.to_string().contains("expected_audience is missing"),
            "{error}"
        );

        // Explicit empty string disables audience validation.
        let dir = write_config(&minimal_document("  expected_audience: \"\"\n"));
        assert_eq!(
            Config::load(dir.path().join("config.yaml"))
                .unwrap()
                .expected_audience,
            ""
        );

        // Values are trimmed; whitespace-only values are rejected.
        let dir = write_config(&minimal_document("  expected_audience: \"  aud  \"\n"));
        assert_eq!(
            Config::load(dir.path().join("config.yaml"))
                .unwrap()
                .expected_audience,
            "aud"
        );
        let dir = write_config(&minimal_document("  expected_audience: \"   \"\n"));
        let error = Config::load(dir.path().join("config.yaml")).unwrap_err();
        assert!(error.to_string().contains("only whitespace"), "{error}");
    }

    #[test]
    fn subscriber_names_cannot_shadow_observers_or_differ_only_by_case() {
        let _lock = ENV_LOCK.lock().unwrap();
        let base = minimal_document("  expected_audience: aud\n");
        let reserved = base.replace(
            "subscribers:\n  default_max_connections: 2\n",
            "subscribers:\n  default_max_connections: 2\n  users:\n    - username: V1_abc\n      password: secret\n      role: 3\n",
        );
        let dir = write_config(&reserved);
        let error = Config::load(dir.path().join("config.yaml")).unwrap_err();
        assert!(
            error.to_string().contains("reserved observer prefix"),
            "{error}"
        );

        let duplicate = base.replace(
            "subscribers:\n  default_max_connections: 2\n",
            "subscribers:\n  default_max_connections: 2\n  users:\n    - username: Viewer\n      password: one\n      role: 3\n    - username: viewer\n      password: two\n      role: 3\n",
        );
        let dir = write_config(&duplicate);
        let error = Config::load(dir.path().join("config.yaml")).unwrap_err();
        assert!(error.to_string().contains("case-insensitive"), "{error}");
    }

    #[test]
    fn zero_payload_limits_are_rejected_from_yaml() {
        let _lock = ENV_LOCK.lock().unwrap();
        let base = minimal_document("  expected_audience: aud\n");
        for (name, message) in [
            ("ws_max_payload_bytes", "mqtt.ws_max_payload_bytes"),
            ("json_publish_max_bytes", "mqtt.json_publish_max_bytes"),
        ] {
            let document = base.replace(
                "  host: 127.0.0.1\n",
                &format!("  host: 127.0.0.1\n  {name}: 0\n"),
            );
            let dir = write_config(&document);
            let error = Config::load(dir.path().join("config.yaml")).unwrap_err();
            assert!(error.to_string().contains(message), "{error}");
        }
    }

    #[test]
    fn trusted_proxy_ranges_are_explicit_and_validated() {
        let _lock = ENV_LOCK.lock().unwrap();
        let base = minimal_document("  expected_audience: aud\n");
        let document = base.replace(
            "  host: 127.0.0.1\n",
            "  host: 127.0.0.1\n  trusted_proxies: [127.0.0.1, 10.0.0.0/8, 2001:db8::/32]\n",
        );
        let dir = write_config(&document);
        let config = Config::load(dir.path().join("config.yaml")).unwrap();
        assert!(config.trusted_proxies[0].contains("127.0.0.1".parse().unwrap()));
        assert!(!config.trusted_proxies[0].contains("127.0.0.2".parse().unwrap()));
        assert!(config.trusted_proxies[1].contains("10.20.30.40".parse().unwrap()));
        assert!(config.trusted_proxies[2].contains("2001:db8::1".parse().unwrap()));
        assert!(!config.trusted_proxies[2].contains("2001:db9::1".parse().unwrap()));

        let invalid = base.replace(
            "  host: 127.0.0.1\n",
            "  host: 127.0.0.1\n  trusted_proxies: [10.0.0.0/33]\n",
        );
        let dir = write_config(&invalid);
        let error = Config::load(dir.path().join("config.yaml")).unwrap_err();
        assert!(error.to_string().contains("trusted_proxies"), "{error}");
    }

    #[test]
    fn disabled_meshcore_io_accepts_an_explicit_empty_api_url() {
        let _lock = ENV_LOCK.lock().unwrap();
        let base = minimal_document("  expected_audience: aud\n");
        let disabled = format!("{base}meshcore_io:\n  enabled: false\n  api_url: \"\"\n");
        let dir = write_config(&disabled);
        let config = Config::load(dir.path().join("config.yaml")).unwrap();
        assert!(!config.meshcore_io.enabled);
        assert!(config.meshcore_io.api_url.is_empty());

        let enabled = disabled.replace("enabled: false", "enabled: true");
        let dir = write_config(&enabled);
        let error = Config::load(dir.path().join("config.yaml")).unwrap_err();
        assert!(error.to_string().contains("api_url must be a valid URL"));
    }

    #[test]
    fn target_tls_verification_cannot_be_disabled() {
        let _lock = ENV_LOCK.lock().unwrap();
        let document = format!(
            "{}target_mqtt:\n  reject_unauthorized: false\n",
            minimal_document("  expected_audience: aud\n")
        );
        let dir = write_config(&document);
        let error = Config::load(dir.path().join("config.yaml")).unwrap_err();
        assert!(
            error
                .to_string()
                .contains("target_mqtt.reject_unauthorized must be true"),
            "{error}"
        );
    }

    #[test]
    fn debug_output_redacts_all_configured_secrets() {
        let _lock = ENV_LOCK.lock().unwrap();
        let mut config = Config::load("config.yaml").unwrap();
        config.subscribers.insert(
            "viewer".into(),
            Subscriber {
                password: "subscriber-secret".into(),
                role: SubscriberRole::Limited,
                max_connections: 1,
            },
        );
        config.target_mqtt.url = "mqtts://url-user:url-secret@example.com:8883".into();
        config.target_mqtt.username = "configured-user".into();
        config.target_mqtt.password = "configured-secret".into();
        config.meshcore_io.private_key = Some("private-signing-key".into());

        let debug = format!("{config:?}");
        for secret in [
            "subscriber-secret",
            "url-user",
            "url-secret",
            "configured-user",
            "configured-secret",
            "private-signing-key",
        ] {
            assert!(
                !debug.contains(secret),
                "debug output leaked a configured secret"
            );
        }
        assert!(debug.contains("<redacted>"));
    }

    #[test]
    fn loads_repository_config() {
        let _lock = ENV_LOCK.lock().unwrap();
        let cfg = Config::load("config.yaml").unwrap();
        assert!(cfg.allowed_iata.contains("STO"));
        assert_eq!(
            cfg.secondary_iata.get("ARN").map(String::as_str),
            Some("STO")
        );
        assert_eq!(cfg.healthcheck.url, "http://127.0.0.1:8883/status");
        assert_eq!(cfg.healthcheck.timeout_ms, 8_000);
    }

    #[test]
    fn legacy_regions_fixture_loads_with_hostname_and_aliases() {
        let _lock = ENV_LOCK.lock().unwrap();
        let cfg = Config::load("tests/fixtures/legacy-regions-config.yaml").unwrap();
        // Implicit allowlist via IATA_whitelist + allowed_regions.
        assert!(cfg.allowed_iata.contains("STO"));
        assert!(cfg.allowed_iata.contains("GOT"));
        assert_eq!(
            cfg.secondary_iata.get("ARN").map(String::as_str),
            Some("STO")
        );
        assert_eq!(
            cfg.secondary_iata.get("BMA").map(String::as_str),
            Some("STO")
        );
        // localhost resolves to an IPv4 loopback address.
        assert_eq!(cfg.listener.port(), 1883);
        assert_eq!(cfg.listener.ip(), std::net::Ipv4Addr::LOCALHOST);
        // maxConnections alias and string role are accepted.
        let admin = cfg.subscribers.get("admin").unwrap();
        assert_eq!(admin.role, SubscriberRole::Admin);
        assert_eq!(admin.max_connections, 5);
    }

    #[test]
    fn list_form_of_allowed_iata_loads_with_implicit_allowlist() {
        let _lock = ENV_LOCK.lock().unwrap();
        let cfg = Config::load("tests/fixtures/list-config.yaml").unwrap();
        assert!(cfg.allowed_iata.contains("STO"));
        assert!(cfg.allowed_iata.contains("GOT"));
        assert!(cfg.secondary_iata.is_empty());
        // Empty expected_audience disables validation.
        assert_eq!(cfg.expected_audience, "");
    }

    #[test]
    fn env_overrides_win_over_yaml_values() {
        let _lock = ENV_LOCK.lock().unwrap();
        const NAMES: [&str; 11] = [
            "MESHCORE_MQTT_WS_PORT",
            "MESHCORE_MQTT_HOST",
            "MESHCORE_AUTH_EXPECTED_AUDIENCE",
            "MESHCORE_AUTH_TOKEN_MAX_AGE_SECONDS",
            "MESHCORE_BROKER_NAME",
            "MESHCORE_SUBSCRIBERS_DEFAULT_MAX_CONNECTIONS",
            "MESHCORE_MQTT_JSON_PUBLISH_MAX_BYTES",
            "MESHCORE_MESHCORE_IO_ENABLED",
            "MESHCORE_TARGET_MQTT_URL",
            "MESHCORE_TARGET_MQTT_USERNAME",
            "MESHCORE_HEALTHCHECK_HTTP_TIMEOUT_MS",
        ];
        struct Cleanup;
        impl Drop for Cleanup {
            fn drop(&mut self) {
                for name in NAMES {
                    // SAFETY: restoring the process environment before the
                    // test lock is released; these names are test-owned.
                    unsafe { std::env::remove_var(name) };
                }
            }
        }
        // SAFETY: the dedicated MESHCORE_* names are only read by this test
        // (serialized by ENV_LOCK) and removed by the Cleanup guard.
        unsafe {
            std::env::set_var(NAMES[0], "1885");
            std::env::set_var(NAMES[1], "127.0.0.1");
            std::env::set_var(NAMES[2], "env-aud");
            std::env::set_var(NAMES[3], "60");
            std::env::set_var(NAMES[4], "EnvBroker");
            std::env::set_var(NAMES[5], "9");
            std::env::set_var(NAMES[6], "4000");
            std::env::set_var(NAMES[7], "true");
            std::env::set_var(NAMES[8], "mqtt://env.example.com:1883");
            std::env::set_var(NAMES[9], "'envuser'");
            std::env::set_var(NAMES[10], "5000");
        }
        let _cleanup = Cleanup;
        let dir = write_config(&minimal_document("  expected_audience: yaml-aud\n"));
        let cfg = Config::load(dir.path().join("config.yaml")).unwrap();
        assert_eq!(cfg.listener.port(), 1885);
        assert_eq!(cfg.expected_audience, "env-aud");
        assert_eq!(cfg.token_max_age_seconds, 60);
        assert_eq!(cfg.broker_name, "EnvBroker");
        assert_eq!(cfg.json_publish_max_bytes, 4_000);
        assert_eq!(cfg.healthcheck.timeout_ms, 5_000);
        assert!(cfg.target_mqtt.enabled);
        // Surrounding quotes are stripped from target credentials.
        assert_eq!(cfg.target_mqtt.username, "envuser");
        assert!(cfg.meshcore_io.enabled);
    }
}
