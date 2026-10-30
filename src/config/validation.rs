use super::document::{HealthcheckDocument, MeshcoreIoDocument, TargetMqttDocument};
use super::environment::{env_bool, env_int, env_quoted_string, env_string};
use super::{ConfigError, HealthcheckConfig, MeshcoreIoConfig, TargetMqttConfig};
use std::net::{SocketAddr, ToSocketAddrs};

/// `localhost`, resolved with IPv4 preferred so loopback healthchecks on
/// 127.0.0.1 keep working.
pub(super) fn resolve_listener(host: &str, port: u16) -> Result<SocketAddr, ConfigError> {
    let mut addresses = (host, port)
        .to_socket_addrs()
        .map_err(|_| {
            ConfigError::Invalid(format!(
                "Configuration value mqtt.host could not be resolved: {host:?}"
            ))
        })?
        .collect::<Vec<_>>();
    if addresses.is_empty() {
        return Err(ConfigError::Invalid(format!(
            "Configuration value mqtt.host resolved to no addresses: {host:?}"
        )));
    }
    addresses.sort_by_key(|address| if address.is_ipv4() { 0 } else { 1 });
    Ok(addresses[0])
}

pub(super) fn validate_healthcheck(
    raw: HealthcheckDocument,
    mqtt_port: u16,
) -> Result<HealthcheckConfig, ConfigError> {
    let timeout_ms = match env_int(&["healthcheck", "http_timeout_ms"], 1_000, 10_000)? {
        Some(value) => value as u64,
        None => {
            if !(1_000..=10_000).contains(&raw.http_timeout_ms) {
                return Err(ConfigError::Invalid(
                    "healthcheck.http_timeout_ms must be between 1000 and 10000".into(),
                ));
            }
            raw.http_timeout_ms as u64
        }
    };
    let http_port = match env_string(&["healthcheck", "http_port"]) {
        Some(port) => Some(port.parse::<u16>().map_err(|_| {
            ConfigError::Invalid("healthcheck.http_port must be a valid port".into())
        })?),
        None => raw.http_port,
    };
    let url = match env_string(&["healthcheck", "http_url"]) {
        Some(url) if !url.is_empty() => url,
        _ if !raw.http_url.trim().is_empty() => raw.http_url.trim().to_owned(),
        _ => format!("http://127.0.0.1:{}/status", http_port.unwrap_or(mqtt_port)),
    };
    let parsed = url::Url::parse(&url)
        .map_err(|_| ConfigError::Invalid("healthcheck.http_url must be a valid URL".into()))?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || parsed.path() != "/status"
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(ConfigError::Invalid(
            "healthcheck.http_url must be an http(s) URL with exact path /status".into(),
        ));
    }
    Ok(HealthcheckConfig { url, timeout_ms })
}

pub(super) fn validate_target_mqtt(
    raw: TargetMqttDocument,
) -> Result<TargetMqttConfig, ConfigError> {
    let url = env_string(&["target_mqtt", "url"]).unwrap_or_else(|| raw.url.trim().to_owned());
    let enabled = !url.is_empty();
    if enabled {
        let parsed = url::Url::parse(&url)
            .map_err(|_| ConfigError::Invalid("target_mqtt.url must be a valid URL".into()))?;
        if !matches!(parsed.scheme(), "mqtt" | "mqtts") || parsed.host_str().is_none() {
            return Err(ConfigError::Invalid(
                "target_mqtt.url must use mqtt:// or mqtts:// with a host".into(),
            ));
        }
    }
    let reconnect_period_ms = match env_int(&["target_mqtt", "reconnect_period_ms"], 0, 300_000)? {
        Some(value) => value,
        None => {
            if enabled && !(0..=300_000).contains(&raw.reconnect_period_ms) {
                return Err(ConfigError::Invalid(
                    "target_mqtt.reconnect_period_ms must be between 0 and 300000".into(),
                ));
            }
            raw.reconnect_period_ms
        }
    };
    let connect_timeout_ms = match env_int(&["target_mqtt", "connect_timeout_ms"], 1_000, 300_000)?
    {
        Some(value) => value,
        None => {
            if enabled && !(1_000..=300_000).contains(&raw.connect_timeout_ms) {
                return Err(ConfigError::Invalid(
                    "target_mqtt.connect_timeout_ms must be between 1000 and 300000".into(),
                ));
            }
            raw.connect_timeout_ms
        }
    };
    let reject_unauthorized =
        env_bool(&["target_mqtt", "reject_unauthorized"])?.unwrap_or(raw.reject_unauthorized);
    if !reject_unauthorized {
        return Err(ConfigError::Invalid(
            "target_mqtt.reject_unauthorized must be true; disabling TLS certificate and hostname verification is not supported"
                .into(),
        ));
    }
    let reconnect_period_ms = if enabled && (1..1_000).contains(&reconnect_period_ms) {
        1_000
    } else if enabled {
        reconnect_period_ms as u64
    } else {
        5_000
    };
    Ok(TargetMqttConfig {
        enabled,
        url,
        username: env_quoted_string(&["target_mqtt", "username"])
            .unwrap_or_else(|| raw.username.trim().to_owned()),
        password: env_quoted_string(&["target_mqtt", "password"])
            .unwrap_or_else(|| raw.password.clone()),
        reconnect_period_ms,
        connect_timeout_ms: if enabled {
            connect_timeout_ms as u64
        } else {
            30_000
        },
    })
}

pub(super) fn validate_meshcore_io(
    raw: MeshcoreIoDocument,
) -> Result<MeshcoreIoConfig, ConfigError> {
    let enabled = env_bool(&["meshcore_io", "enabled"])?.unwrap_or(raw.enabled);
    let api_url =
        env_string(&["meshcore_io", "api_url"]).unwrap_or_else(|| raw.api_url.trim().to_owned());
    if enabled || !api_url.is_empty() {
        let parsed = url::Url::parse(&api_url)
            .map_err(|_| ConfigError::Invalid("meshcore_io.api_url must be a valid URL".into()))?;
        if !matches!(parsed.scheme(), "http" | "https")
            || parsed.host_str().is_none()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
        {
            return Err(ConfigError::Invalid(
                "meshcore_io.api_url must be an http(s) URL without credentials".into(),
            ));
        }
    }
    let private_key = env_string(&["meshcore_io", "private_key"])
        .unwrap_or_else(|| raw.private_key.trim().to_owned());
    if !private_key.is_empty() && !matches!(private_key.len(), 64 | 128)
        || !private_key.is_empty() && !private_key.bytes().all(|value| value.is_ascii_hexdigit())
    {
        return Err(ConfigError::Invalid(
            "meshcore_io.private_key must contain 64 or 128 hexadecimal characters".into(),
        ));
    }
    if private_key.len() == 128 {
        let key = hex::decode(&private_key).expect("validated hex");
        if key[0] & 7 != 0 || key[31] & 0xc0 != 0x40 {
            return Err(ConfigError::Invalid(
                "meshcore_io.private_key is not a valid clamped MeshCore expanded key".into(),
            ));
        }
    }
    fn bounded(name: &str, value: i64, min: i64, max: i64) -> Result<u64, ConfigError> {
        if !(min..=max).contains(&value) {
            return Err(ConfigError::Invalid(format!(
                "meshcore_io.{name} must be between {min} and {max}"
            )));
        }
        Ok(value as u64)
    }
    fn env_bounded(name: &str, raw: i64, min: i64, max: i64) -> Result<i64, ConfigError> {
        match env_int(&["meshcore_io", name], min, max)? {
            Some(value) => Ok(value),
            None => {
                bounded(name, raw, min, max)?;
                Ok(raw)
            }
        }
    }
    Ok(MeshcoreIoConfig {
        enabled,
        api_url,
        dry_run: env_bool(&["meshcore_io", "dry_run"])?.unwrap_or(raw.dry_run),
        private_key: (!private_key.is_empty()).then(|| private_key.to_owned()),
        min_reupload_seconds: env_bounded(
            "min_reupload_seconds",
            raw.min_reupload_seconds,
            0,
            86_400,
        )? as u64,
        request_timeout_ms: env_bounded(
            "request_timeout_ms",
            raw.request_timeout_ms,
            1_000,
            120_000,
        )? as u64,
        workers: env_bounded("workers", raw.workers, 1, 32)? as usize,
        max_queued_uploads: env_bounded("max_queued_uploads", raw.max_queued_uploads, 1, 100_000)?
            as usize,
        attempts: env_bounded("attempts", raw.attempts, 1, 100)? as u32,
        retry_delay_ms: env_bounded("retry_delay_ms", raw.retry_delay_ms, 0, 300_000)? as u64,
        ingress_dedup_ms: env_bounded("ingress_dedup_ms", raw.ingress_dedup_ms, 1_000, 300_000)?
            as u64,
    })
}

pub(super) fn resolve_expected_audience(raw: Option<String>) -> Result<String, ConfigError> {
    match raw {
        None => Err(ConfigError::Invalid(
            "auth.expected_audience is missing. Set a value, or use an empty string to disable audience validation"
                .into(),
        )),
        Some(value) if value.is_empty() => Ok(String::new()),
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                return Err(ConfigError::Invalid(
                    "auth.expected_audience may be empty or non-empty, but may not contain only whitespace"
                        .into(),
                ));
            }
            Ok(trimmed.to_owned())
        }
    }
}
