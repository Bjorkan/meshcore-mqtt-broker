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
        })
    }
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
    }
}
