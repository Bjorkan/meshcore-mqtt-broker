use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::net::{IpAddr, SocketAddr};
use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("could not read configuration {path}: {source}")]
    Read {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("could not parse configuration {path}: {source}")]
    Parse {
        path: PathBuf,
        source: serde_yaml::Error,
    },
    #[error("invalid configuration: {0}")]
    Invalid(String),
}

#[derive(Clone, Debug)]
pub struct Config {
    pub listener: SocketAddr,
    pub ws_max_payload_bytes: u32,
    pub json_publish_max_bytes: usize,
    pub broker_name: String,
    pub expected_audience: String,
    pub token_max_age_seconds: i64,
    pub subscribers: HashMap<String, Subscriber>,
    pub allowed_iata: HashSet<String>,
    pub secondary_iata: HashMap<String, String>,
    pub allow_test_ingress: bool,
    pub target_mqtt: TargetMqttConfig,
    pub meshcore_io: MeshcoreIoConfig,
    pub healthcheck: HealthcheckConfig,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HealthcheckConfig {
    pub url: String,
    pub timeout_ms: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TargetMqttConfig {
    pub enabled: bool,
    pub url: String,
    pub username: String,
    pub password: String,
    pub reconnect_period_ms: u64,
    pub connect_timeout_ms: u64,
    pub reject_unauthorized: bool,
}

impl Default for TargetMqttConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            url: String::new(),
            username: String::new(),
            password: String::new(),
            reconnect_period_ms: 5_000,
            connect_timeout_ms: 30_000,
            reject_unauthorized: true,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct MeshcoreIoConfig {
    pub enabled: bool,
    pub api_url: String,
    pub dry_run: bool,
    pub private_key: Option<String>,
    pub min_reupload_seconds: u64,
    pub request_timeout_ms: u64,
    pub workers: usize,
    pub max_queued_uploads: usize,
    pub attempts: u32,
    pub retry_delay_ms: u64,
    pub ingress_dedup_ms: u64,
}

impl Default for MeshcoreIoConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            api_url: "https://map.meshcore.io/api/v1/uploader/node".into(),
            dry_run: false,
            private_key: None,
            min_reupload_seconds: 3_600,
            request_timeout_ms: 10_000,
            workers: 1,
            max_queued_uploads: 250,
            attempts: 3,
            retry_delay_ms: 5_000,
            ingress_dedup_ms: 10_000,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Subscriber {
    pub password: String,
    pub role: SubscriberRole,
    pub max_connections: usize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SubscriberRole {
    Admin = 1,
    FullAccess = 2,
    Limited = 3,
}

#[derive(Deserialize)]
struct Document {
    mqtt: Mqtt,
    #[serde(default)]
    broker: Broker,
    auth: Auth,
    #[serde(default)]
    subscribers: Subscribers,
    iata: Iata,
    allowed_iata: HashMap<String, IataEntry>,
    #[serde(default)]
    target_mqtt: TargetMqttDocument,
    #[serde(default)]
    meshcore_io: MeshcoreIoDocument,
    #[serde(default)]
    healthcheck: HealthcheckDocument,
}

#[derive(Deserialize)]
#[serde(default)]
struct HealthcheckDocument {
    http_timeout_ms: i64,
    http_port: Option<u16>,
    http_url: String,
}

impl Default for HealthcheckDocument {
    fn default() -> Self {
        Self {
            http_timeout_ms: 8_000,
            http_port: None,
            http_url: String::new(),
        }
    }
}

#[derive(Deserialize)]
#[serde(default)]
struct TargetMqttDocument {
    url: String,
    username: String,
    password: String,
    reconnect_period_ms: i64,
    connect_timeout_ms: i64,
    reject_unauthorized: bool,
}

impl Default for TargetMqttDocument {
    fn default() -> Self {
        Self {
            url: String::new(),
            username: String::new(),
            password: String::new(),
            reconnect_period_ms: 5_000,
            connect_timeout_ms: 30_000,
            reject_unauthorized: true,
        }
    }
}

#[derive(Deserialize)]
#[serde(default)]
struct MeshcoreIoDocument {
    enabled: bool,
    api_url: String,
    dry_run: bool,
    private_key: String,
    min_reupload_seconds: i64,
    request_timeout_ms: i64,
    workers: i64,
    max_queued_uploads: i64,
    attempts: i64,
    retry_delay_ms: i64,
    ingress_dedup_ms: i64,
}

impl Default for MeshcoreIoDocument {
    fn default() -> Self {
        Self {
            enabled: false,
            api_url: "https://map.meshcore.io/api/v1/uploader/node".into(),
            dry_run: false,
            private_key: String::new(),
            min_reupload_seconds: 3_600,
            request_timeout_ms: 10_000,
            workers: 1,
            max_queued_uploads: 250,
            attempts: 3,
            retry_delay_ms: 5_000,
            ingress_dedup_ms: 10_000,
        }
    }
}

#[derive(Deserialize)]
struct Mqtt {
    ws_port: u16,
    host: IpAddr,
    #[serde(default = "default_ws_max")]
    ws_max_payload_bytes: u32,
    #[serde(default = "default_json_max")]
    json_publish_max_bytes: usize,
}
fn default_ws_max() -> u32 {
    65_536
}
fn default_json_max() -> usize {
    8_192
}

#[derive(Default, Deserialize)]
struct Broker {
    #[serde(default = "default_broker_name")]
    name: String,
}
fn default_broker_name() -> String {
    "Broker".into()
}

#[derive(Deserialize)]
struct Auth {
    #[serde(default)]
    expected_audience: String,
    #[serde(default)]
    token_max_age_seconds: i64,
}

#[derive(Default, Deserialize)]
struct Subscribers {
    #[serde(default = "default_max_connections")]
    default_max_connections: usize,
    #[serde(default)]
    users: Vec<SubscriberEntry>,
}
fn default_max_connections() -> usize {
    2
}

#[derive(Deserialize)]
struct SubscriberEntry {
    username: String,
    password: String,
    #[serde(default = "default_role")]
    role: u8,
    max_connections: Option<usize>,
}
fn default_role() -> u8 {
    3
}

#[derive(Deserialize)]
struct Iata {
    allowlist_enabled: bool,
    #[serde(default)]
    allow_test_ingress: bool,
}

#[derive(Default, Deserialize)]
struct IataEntry {
    #[serde(default, deserialize_with = "csv_or_vec")]
    secondary_iata: Vec<String>,
}

fn csv_or_vec<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Value {
        Text(String),
        List(Vec<String>),
    }
    let value = Option::<Value>::deserialize(deserializer)?;
    Ok(match value {
        None => vec![],
        Some(Value::Text(v)) => v
            .split(',')
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(str::to_owned)
            .collect(),
        Some(Value::List(v)) => v,
    })
}

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
        if !doc.iata.allowlist_enabled {
            return Err(ConfigError::Invalid(
                "iata.allowlist_enabled must be true".into(),
            ));
        }
        if doc.allowed_iata.is_empty() {
            return Err(ConfigError::Invalid(
                "allowed_iata must not be empty".into(),
            ));
        }
        if doc.auth.token_max_age_seconds < 0 {
            return Err(ConfigError::Invalid(
                "auth.token_max_age_seconds must be >= 0".into(),
            ));
        }
        if doc.subscribers.default_max_connections == 0 {
            return Err(ConfigError::Invalid(
                "subscribers.default_max_connections must be > 0".into(),
            ));
        }

        let target_mqtt = validate_target_mqtt(doc.target_mqtt)?;
        let meshcore_io = validate_meshcore_io(doc.meshcore_io)?;

        let mut allowed_iata = HashSet::new();
        let mut secondary_iata = HashMap::new();
        for (raw, entry) in doc.allowed_iata {
            let primary = normalize_iata(&raw)?;
            if !allowed_iata.insert(primary.clone()) {
                return Err(ConfigError::Invalid(format!(
                    "duplicate primary IATA {primary}"
                )));
            }
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
        if secondary_iata
            .keys()
            .any(|code| allowed_iata.contains(code))
        {
            return Err(ConfigError::Invalid(
                "an IATA code cannot be both primary and secondary".into(),
            ));
        }

        let mut subscribers = HashMap::new();
        for user in doc.subscribers.users {
            if user.username.trim().is_empty() || user.password.is_empty() {
                return Err(ConfigError::Invalid(
                    "subscriber username/password must not be empty".into(),
                ));
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
            let max_connections = user
                .max_connections
                .unwrap_or(doc.subscribers.default_max_connections);
            if max_connections == 0 {
                return Err(ConfigError::Invalid(
                    "subscriber max_connections must be > 0".into(),
                ));
            }
            let subscriber = Subscriber {
                password: user.password,
                role,
                max_connections,
            };
            if subscribers.insert(user.username, subscriber).is_some() {
                return Err(ConfigError::Invalid("duplicate subscriber username".into()));
            }
        }

        let healthcheck = validate_healthcheck(doc.healthcheck, doc.mqtt.ws_port)?;
        Ok(Self {
            listener: SocketAddr::new(doc.mqtt.host, doc.mqtt.ws_port),
            ws_max_payload_bytes: doc.mqtt.ws_max_payload_bytes,
            json_publish_max_bytes: doc.mqtt.json_publish_max_bytes,
            broker_name: doc.broker.name,
            expected_audience: doc.auth.expected_audience,
            token_max_age_seconds: doc.auth.token_max_age_seconds,
            subscribers,
            allowed_iata,
            secondary_iata,
            allow_test_ingress: doc.iata.allow_test_ingress,
            target_mqtt,
            meshcore_io,
            healthcheck,
        })
    }
}

fn validate_healthcheck(
    raw: HealthcheckDocument,
    mqtt_port: u16,
) -> Result<HealthcheckConfig, ConfigError> {
    if !(1_000..=10_000).contains(&raw.http_timeout_ms) {
        return Err(ConfigError::Invalid(
            "healthcheck.http_timeout_ms must be between 1000 and 10000".into(),
        ));
    }
    let url = if raw.http_url.trim().is_empty() {
        format!(
            "http://127.0.0.1:{}/status",
            raw.http_port.unwrap_or(mqtt_port)
        )
    } else {
        raw.http_url.trim().to_owned()
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
    Ok(HealthcheckConfig {
        url,
        timeout_ms: raw.http_timeout_ms as u64,
    })
}

fn validate_target_mqtt(raw: TargetMqttDocument) -> Result<TargetMqttConfig, ConfigError> {
    let url = raw.url.trim().to_owned();
    let enabled = !url.is_empty();
    if enabled {
        let parsed = url::Url::parse(&url)
            .map_err(|_| ConfigError::Invalid("target_mqtt.url must be a valid URL".into()))?;
        if !matches!(parsed.scheme(), "mqtt" | "mqtts") || parsed.host_str().is_none() {
            return Err(ConfigError::Invalid(
                "target_mqtt.url must use mqtt:// or mqtts:// with a host".into(),
            ));
        }
        if !(0..=300_000).contains(&raw.reconnect_period_ms) {
            return Err(ConfigError::Invalid(
                "target_mqtt.reconnect_period_ms must be between 0 and 300000".into(),
            ));
        }
        if !(1_000..=300_000).contains(&raw.connect_timeout_ms) {
            return Err(ConfigError::Invalid(
                "target_mqtt.connect_timeout_ms must be between 1000 and 300000".into(),
            ));
        }
    }
    let reconnect_period_ms = if enabled && (1..1_000).contains(&raw.reconnect_period_ms) {
        1_000
    } else if enabled {
        raw.reconnect_period_ms as u64
    } else {
        5_000
    };
    Ok(TargetMqttConfig {
        enabled,
        url,
        username: raw.username.trim().to_owned(),
        password: raw.password,
        reconnect_period_ms,
        connect_timeout_ms: if enabled {
            raw.connect_timeout_ms as u64
        } else {
            30_000
        },
        reject_unauthorized: raw.reject_unauthorized,
    })
}

fn validate_meshcore_io(raw: MeshcoreIoDocument) -> Result<MeshcoreIoConfig, ConfigError> {
    let api_url = raw.api_url.trim().to_owned();
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
    let private_key = raw.private_key.trim();
    if !private_key.is_empty() && !matches!(private_key.len(), 64 | 128)
        || !private_key.is_empty() && !private_key.bytes().all(|value| value.is_ascii_hexdigit())
    {
        return Err(ConfigError::Invalid(
            "meshcore_io.private_key must contain 64 or 128 hexadecimal characters".into(),
        ));
    }
    if private_key.len() == 128 {
        let key = hex::decode(private_key).expect("validated hex");
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
    Ok(MeshcoreIoConfig {
        enabled: raw.enabled,
        api_url,
        dry_run: raw.dry_run,
        private_key: (!private_key.is_empty()).then(|| private_key.to_owned()),
        min_reupload_seconds: bounded("min_reupload_seconds", raw.min_reupload_seconds, 0, 86_400)?,
        request_timeout_ms: bounded("request_timeout_ms", raw.request_timeout_ms, 1_000, 120_000)?,
        workers: bounded("workers", raw.workers, 1, 32)? as usize,
        max_queued_uploads: bounded("max_queued_uploads", raw.max_queued_uploads, 1, 100_000)?
            as usize,
        attempts: bounded("attempts", raw.attempts, 1, 100)? as u32,
        retry_delay_ms: bounded("retry_delay_ms", raw.retry_delay_ms, 0, 300_000)?,
        ingress_dedup_ms: bounded("ingress_dedup_ms", raw.ingress_dedup_ms, 1_000, 300_000)?,
    })
}

fn normalize_iata(raw: &str) -> Result<String, ConfigError> {
    let code = raw.trim().to_ascii_uppercase();
    if code.len() != 3 || !code.bytes().all(|v| v.is_ascii_alphabetic()) {
        return Err(ConfigError::Invalid(format!(
            "IATA code must be exactly three letters, got {raw:?}"
        )));
    }
    Ok(code)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn loads_repository_config() {
        let cfg = Config::load("config.yaml").unwrap();
        assert!(cfg.allowed_iata.contains("STO"));
        assert_eq!(
            cfg.secondary_iata.get("ARN").map(String::as_str),
            Some("STO")
        );
        assert_eq!(cfg.healthcheck.url, "http://127.0.0.1:8883/status");
        assert_eq!(cfg.healthcheck.timeout_ms, 8_000);
    }
}
