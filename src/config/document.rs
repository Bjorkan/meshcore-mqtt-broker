use serde::Deserialize;
use std::collections::HashMap;

#[derive(Deserialize)]
pub(super) struct Document {
    pub(super) mqtt: Mqtt,
    #[serde(default)]
    pub(super) broker: Broker,
    pub(super) auth: Auth,
    #[serde(default)]
    pub(super) subscribers: Subscribers,
    #[serde(default)]
    pub(super) iata: Iata,
    #[serde(default)]
    pub(super) allowed_iata: Option<IataAllowlist>,
    #[serde(default)]
    pub(super) allowed_regions: Option<IataAllowlist>,
    #[serde(default, rename = "IATA_whitelist")]
    pub(super) iata_whitelist: Option<bool>,
    #[serde(default)]
    pub(super) target_mqtt: TargetMqttDocument,
    #[serde(default)]
    pub(super) meshcore_io: MeshcoreIoDocument,
    #[serde(default)]
    pub(super) healthcheck: HealthcheckDocument,
}

#[derive(Deserialize)]
#[serde(untagged)]
pub(super) enum IataAllowlist {
    /// Legacy list form: `allowed_iata: [STO, GOT]`.
    List(Vec<String>),
    /// Object form with per-code entries.
    Entries(HashMap<String, IataEntry>),
}

impl IataAllowlist {
    pub(super) fn is_empty(&self) -> bool {
        match self {
            IataAllowlist::List(list) => list.is_empty(),
            IataAllowlist::Entries(entries) => entries.is_empty(),
        }
    }
}

#[derive(Deserialize)]
#[serde(default)]
pub(super) struct HealthcheckDocument {
    pub(super) http_timeout_ms: i64,
    pub(super) http_port: Option<u16>,
    pub(super) http_url: String,
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
pub(super) struct TargetMqttDocument {
    pub(super) url: String,
    pub(super) username: String,
    pub(super) password: String,
    pub(super) reconnect_period_ms: i64,
    pub(super) connect_timeout_ms: i64,
    pub(super) reject_unauthorized: bool,
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
pub(super) struct MeshcoreIoDocument {
    pub(super) enabled: bool,
    pub(super) api_url: String,
    pub(super) dry_run: bool,
    pub(super) private_key: String,
    pub(super) min_reupload_seconds: i64,
    pub(super) request_timeout_ms: i64,
    pub(super) workers: i64,
    pub(super) max_queued_uploads: i64,
    pub(super) attempts: i64,
    pub(super) retry_delay_ms: i64,
    pub(super) ingress_dedup_ms: i64,
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
pub(super) struct Mqtt {
    /// Required at resolution time, but the legacy deployment allows the
    /// `MESHCORE_MQTT_WS_PORT` environment override to provide it.
    pub(super) ws_port: Option<u16>,
    /// Hostnames (e.g. `localhost`) are resolved like the legacy broker.
    pub(super) host: Option<String>,
    /// Only peers in these IP/CIDR ranges may supply X-Forwarded-For.
    #[serde(default, deserialize_with = "csv_or_vec")]
    pub(super) trusted_proxies: Vec<String>,
    #[serde(default = "default_ws_max")]
    pub(super) ws_max_payload_bytes: u32,
    #[serde(default = "default_json_max")]
    pub(super) json_publish_max_bytes: usize,
}
fn default_ws_max() -> u32 {
    65_536
}
fn default_json_max() -> usize {
    8_192
}

#[derive(Default, Deserialize)]
pub(super) struct Broker {
    #[serde(default = "default_broker_name")]
    pub(super) name: String,
}
fn default_broker_name() -> String {
    "Broker".into()
}

#[derive(Deserialize)]
pub(super) struct Auth {
    /// `Option` distinguishes a missing key (config error) from an explicit
    /// empty string (audience validation disabled), mirroring the legacy
    /// requiredAudience() contract.
    pub(super) expected_audience: Option<String>,
    #[serde(default)]
    pub(super) token_max_age_seconds: i64,
}

#[derive(Default, Deserialize)]
pub(super) struct Subscribers {
    /// Required at resolution time; may come from the environment override.
    pub(super) default_max_connections: Option<usize>,
    #[serde(default)]
    pub(super) users: Vec<SubscriberEntry>,
}

#[derive(Deserialize)]
pub(super) struct SubscriberEntry {
    pub(super) username: String,
    pub(super) password: String,
    #[serde(default = "default_role", deserialize_with = "number_or_string_u8")]
    pub(super) role: u8,
    /// The legacy `maxConnections` alias is accepted like the TS loader.
    #[serde(
        default,
        alias = "maxConnections",
        deserialize_with = "option_number_or_string_usize"
    )]
    pub(super) max_connections: Option<usize>,
}
fn default_role() -> u8 {
    3
}

#[derive(Deserialize)]
#[serde(untagged)]
pub(super) enum NumberOrString {
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
pub(super) struct Iata {
    pub(super) allowlist_enabled: Option<bool>,
    #[serde(default)]
    pub(super) allow_test_ingress: bool,
}

#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct IataEntry {
    pub(super) friendly_name: Option<String>,
    #[serde(default, alias = "secondary_region", deserialize_with = "csv_or_vec")]
    pub(super) secondary_iata: Vec<String>,
}

pub(super) fn csv_or_vec<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    pub(super) enum Value {
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
