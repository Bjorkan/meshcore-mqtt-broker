use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::net::{SocketAddr, ToSocketAddrs};
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
    #[serde(default)]
    iata: Iata,
    #[serde(default)]
    allowed_iata: Option<IataAllowlist>,
    #[serde(default)]
    allowed_regions: Option<IataAllowlist>,
    #[serde(default, rename = "IATA_whitelist")]
    iata_whitelist: Option<bool>,
    #[serde(default)]
    target_mqtt: TargetMqttDocument,
    #[serde(default)]
    meshcore_io: MeshcoreIoDocument,
    #[serde(default)]
    healthcheck: HealthcheckDocument,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum IataAllowlist {
    /// Legacy list form: `allowed_iata: [STO, GOT]`.
    List(Vec<String>),
    /// Object form with per-code entries.
    Entries(HashMap<String, IataEntry>),
}

impl IataAllowlist {
    fn is_empty(&self) -> bool {
        match self {
            IataAllowlist::List(list) => list.is_empty(),
            IataAllowlist::Entries(entries) => entries.is_empty(),
        }
    }
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
    /// Required at resolution time, but the legacy deployment allows the
    /// `MESHCORE_MQTT_WS_PORT` environment override to provide it.
    ws_port: Option<u16>,
    /// Hostnames (e.g. `localhost`) are resolved like the legacy broker.
    host: Option<String>,
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
    /// `Option` distinguishes a missing key (config error) from an explicit
    /// empty string (audience validation disabled), mirroring the legacy
    /// requiredAudience() contract.
    expected_audience: Option<String>,
    #[serde(default)]
    token_max_age_seconds: i64,
}

#[derive(Default, Deserialize)]
struct Subscribers {
    /// Required at resolution time; may come from the environment override.
    default_max_connections: Option<usize>,
    #[serde(default)]
    users: Vec<SubscriberEntry>,
}

#[derive(Deserialize)]
struct SubscriberEntry {
    username: String,
    password: String,
    #[serde(default = "default_role", deserialize_with = "number_or_string_u8")]
    role: u8,
    /// The legacy `maxConnections` alias is accepted like the TS loader.
    #[serde(
        default,
        alias = "maxConnections",
        deserialize_with = "option_number_or_string_usize"
    )]
    max_connections: Option<usize>,
}
fn default_role() -> u8 {
    3
}

#[derive(Deserialize)]
#[serde(untagged)]
enum NumberOrString {
    Number(u64),
    Text(String),
}

fn number_or_string_u8<'de, D>(deserializer: D) -> Result<u8, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::Error;
    match NumberOrString::deserialize(deserializer)? {
        NumberOrString::Number(value) => u8::try_from(value).map_err(D::Error::custom),
        NumberOrString::Text(value) => value
            .trim()
            .parse::<u8>()
            .map_err(|error| D::Error::custom(format!("invalid number {value:?}: {error}"))),
    }
}

fn option_number_or_string_usize<'de, D>(deserializer: D) -> Result<Option<usize>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::Error;
    match Option::<NumberOrString>::deserialize(deserializer)? {
        None => Ok(None),
        Some(NumberOrString::Number(value)) => {
            usize::try_from(value).map(Some).map_err(D::Error::custom)
        }
        Some(NumberOrString::Text(value)) => value
            .trim()
            .parse::<usize>()
            .map(Some)
            .map_err(|error| D::Error::custom(format!("invalid number {value:?}: {error}"))),
    }
}

#[derive(Default, Deserialize)]
struct Iata {
    allowlist_enabled: Option<bool>,
    #[serde(default)]
    allow_test_ingress: bool,
}

#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct IataEntry {
    friendly_name: Option<String>,
    #[serde(default, alias = "secondary_region", deserialize_with = "csv_or_vec")]
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

/// Legacy `MESHCORE_*` environment overrides: the variable name is
/// `MESHCORE_` + the setting path joined with underscores, uppercased.
/// A missing or whitespace-only variable never overrides the YAML value.
fn env_value(path: &[&str]) -> Option<String> {
    let name = format!("MESHCORE_{}", path.join("_").to_ascii_uppercase());
    std::env::var(name)
        .ok()
        .filter(|raw| !raw.trim().is_empty())
}

fn env_string(path: &[&str]) -> Option<String> {
    env_value(path).map(|raw| raw.trim().to_owned())
}

/// Like `env_string`, but also strips one pair of surrounding quotes the
/// way the legacy `envString()` did for target credentials.
fn env_quoted_string(path: &[&str]) -> Option<String> {
    let trimmed = env_string(path)?;
    if trimmed.len() >= 2 {
        let first = trimmed.as_bytes()[0];
        let last = trimmed.as_bytes()[trimmed.len() - 1];
        if (first == b'"' && last == b'"') || (first == b'\'' && last == b'\'') {
            return Some(trimmed[1..trimmed.len() - 1].to_owned());
        }
    }
    Some(trimmed)
}

fn env_int(path: &[&str], min: i64, max: i64) -> Result<Option<i64>, ConfigError> {
    let Some(raw) = env_value(path) else {
        return Ok(None);
    };
    let raw = raw.trim();
    let value: i64 = raw.parse().map_err(|_| {
        ConfigError::Invalid(format!(
            "Configuration value {} must be an integer, got {raw:?}",
            path.join(".")
        ))
    })?;
    if !(min..=max).contains(&value) {
        return Err(ConfigError::Invalid(format!(
            "Configuration value {} must be between {min} and {max}",
            path.join(".")
        )));
    }
    Ok(Some(value))
}

fn env_bool(path: &[&str]) -> Result<Option<bool>, ConfigError> {
    let Some(raw) = env_value(path) else {
        return Ok(None);
    };
    match raw.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Ok(Some(true)),
        "0" | "false" | "no" | "off" => Ok(Some(false)),
        other => Err(ConfigError::Invalid(format!(
            "Configuration value {} must be true/false/yes/no/on/off/1/0, got {other:?}",
            path.join(".")
        ))),
    }
}

/// Bind the legacy `mqtt.host` value: it may be a hostname such as
/// `localhost`, resolved with IPv4 preferred so loopback healthchecks on
/// 127.0.0.1 keep working.
fn resolve_listener(host: &str, port: u16) -> Result<SocketAddr, ConfigError> {
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

const FRIENDLY_NAME_MAX_LENGTH: usize = 120;

/// The legacy loader validated `friendly_name`: a non-empty string without
/// control characters, at most 120 characters.
fn validate_friendly_name(raw: Option<&str>, code: &str) -> Result<(), ConfigError> {
    let Some(name) = raw else {
        return Ok(());
    };
    let name = name.trim();
    if name.is_empty() {
        return Err(ConfigError::Invalid(format!(
            "Configuration value allowed_iata.{code}.friendly_name must not be empty"
        )));
    }
    if name.chars().count() > FRIENDLY_NAME_MAX_LENGTH {
        return Err(ConfigError::Invalid(format!(
            "Configuration value allowed_iata.{code}.friendly_name must be at most {FRIENDLY_NAME_MAX_LENGTH} characters"
        )));
    }
    if name.chars().any(|ch| ch.is_control()) {
        return Err(ConfigError::Invalid(format!(
            "Configuration value allowed_iata.{code}.friendly_name must not contain control characters"
        )));
    }
    Ok(())
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
            let max_connections = user.max_connections.unwrap_or(default_max_connections);
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

        Ok(Self {
            listener,
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

fn validate_healthcheck(
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

fn validate_target_mqtt(raw: TargetMqttDocument) -> Result<TargetMqttConfig, ConfigError> {
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
        reject_unauthorized,
    })
}

fn validate_meshcore_io(raw: MeshcoreIoDocument) -> Result<MeshcoreIoConfig, ConfigError> {
    let api_url =
        env_string(&["meshcore_io", "api_url"]).unwrap_or_else(|| raw.api_url.trim().to_owned());
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
        enabled: env_bool(&["meshcore_io", "enabled"])?.unwrap_or(raw.enabled),
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

fn normalize_iata(raw: &str) -> Result<String, ConfigError> {
    let code = raw.trim().to_ascii_uppercase();
    if code.len() != 3 || !code.bytes().all(|v| v.is_ascii_alphabetic()) {
        return Err(ConfigError::Invalid(format!(
            "IATA code must be exactly three letters, got {raw:?}"
        )));
    }
    Ok(code)
}

/// Mirrors the legacy `requiredAudience()` contract: the key must be present,
/// an explicit empty string disables audience validation, a value containing
/// only whitespace is rejected, and any other value is trimmed.
fn resolve_expected_audience(raw: Option<String>) -> Result<String, ConfigError> {
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
