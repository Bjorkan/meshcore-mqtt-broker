use std::collections::{HashMap, HashSet};
use std::fmt;
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
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

#[derive(Clone)]
pub struct Config {
    pub listener: SocketAddr,
    pub trusted_proxies: Vec<IpNetwork>,
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

/// An IPv4 or IPv6 address range allowed to supply forwarding headers.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IpNetwork {
    address: IpAddr,
    prefix_len: u8,
}

#[derive(Debug, thiserror::Error)]
pub enum IpNetworkParseError {
    #[error("invalid IP address {value:?}")]
    InvalidAddress {
        value: String,
        #[source]
        source: std::net::AddrParseError,
    },
    #[error("invalid prefix length {value:?}")]
    InvalidPrefix {
        value: String,
        #[source]
        source: std::num::ParseIntError,
    },
    #[error("prefix length {prefix_len} exceeds {maximum}")]
    PrefixTooLong { prefix_len: u8, maximum: u8 },
}

impl IpNetwork {
    pub fn contains(&self, candidate: IpAddr) -> bool {
        match (self.address, candidate) {
            (IpAddr::V4(network), IpAddr::V4(candidate)) => {
                let prefix = u32::from(self.prefix_len);
                let mask = if prefix == 0 {
                    0
                } else {
                    u32::MAX << (32 - prefix)
                };
                u32::from(network) & mask == u32::from(candidate) & mask
            }
            (IpAddr::V6(network), IpAddr::V6(candidate)) => {
                let prefix = u32::from(self.prefix_len);
                let mask = if prefix == 0 {
                    0
                } else {
                    u128::MAX << (128 - prefix)
                };
                u128::from(network) & mask == u128::from(candidate) & mask
            }
            _ => false,
        }
    }
}

impl std::str::FromStr for IpNetwork {
    type Err = IpNetworkParseError;

    fn from_str(raw: &str) -> Result<Self, Self::Err> {
        let raw = raw.trim();
        let (address, prefix) = raw
            .split_once('/')
            .map_or((raw, None), |(address, prefix)| {
                (address.trim(), Some(prefix.trim()))
            });
        let address =
            address
                .parse::<IpAddr>()
                .map_err(|source| IpNetworkParseError::InvalidAddress {
                    value: address.to_owned(),
                    source,
                })?;
        let maximum = if address.is_ipv4() { 32 } else { 128 };
        let prefix_len = match prefix {
            Some(value) => {
                value
                    .parse::<u8>()
                    .map_err(|source| IpNetworkParseError::InvalidPrefix {
                        value: value.to_owned(),
                        source,
                    })?
            }
            None => maximum,
        };
        if prefix_len > maximum {
            return Err(IpNetworkParseError::PrefixTooLong {
                prefix_len,
                maximum,
            });
        }
        Ok(Self {
            address,
            prefix_len,
        })
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HealthcheckConfig {
    pub url: String,
    pub timeout_ms: u64,
}

#[derive(Clone, Eq, PartialEq)]
pub struct TargetMqttConfig {
    pub enabled: bool,
    pub url: String,
    pub username: String,
    pub password: String,
    pub reconnect_period_ms: u64,
    pub connect_timeout_ms: u64,
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
        }
    }
}

#[derive(Clone, PartialEq)]
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

#[derive(Clone, Eq, PartialEq)]
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

impl fmt::Debug for Subscriber {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("Subscriber")
            .field("password", &"<redacted>")
            .field("role", &self.role)
            .field("max_connections", &self.max_connections)
            .finish()
    }
}

impl fmt::Debug for TargetMqttConfig {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut url = self.url.clone();
        if let Ok(mut parsed) = url::Url::parse(&url) {
            if !parsed.username().is_empty() {
                let _ = parsed.set_username("<redacted>");
            }
            if parsed.password().is_some() {
                let _ = parsed.set_password(Some("<redacted>"));
            }
            url = parsed.to_string();
        } else if !url.is_empty() {
            url = "<invalid target URL; redacted>".into();
        }
        formatter
            .debug_struct("TargetMqttConfig")
            .field("enabled", &self.enabled)
            .field("url", &url)
            .field("username", &"<redacted>")
            .field("password", &"<redacted>")
            .field("reconnect_period_ms", &self.reconnect_period_ms)
            .field("connect_timeout_ms", &self.connect_timeout_ms)
            .finish()
    }
}

impl fmt::Debug for MeshcoreIoConfig {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("MeshcoreIoConfig")
            .field("enabled", &self.enabled)
            .field("api_url", &self.api_url)
            .field("dry_run", &self.dry_run)
            .field(
                "private_key",
                &self.private_key.as_ref().map(|_| "<redacted>"),
            )
            .field("min_reupload_seconds", &self.min_reupload_seconds)
            .field("request_timeout_ms", &self.request_timeout_ms)
            .field("workers", &self.workers)
            .field("max_queued_uploads", &self.max_queued_uploads)
            .field("attempts", &self.attempts)
            .field("retry_delay_ms", &self.retry_delay_ms)
            .field("ingress_dedup_ms", &self.ingress_dedup_ms)
            .finish()
    }
}

impl fmt::Debug for Config {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("Config")
            .field("listener", &self.listener)
            .field("trusted_proxies", &self.trusted_proxies)
            .field("ws_max_payload_bytes", &self.ws_max_payload_bytes)
            .field("json_publish_max_bytes", &self.json_publish_max_bytes)
            .field("broker_name", &self.broker_name)
            .field("expected_audience", &self.expected_audience)
            .field("token_max_age_seconds", &self.token_max_age_seconds)
            .field("subscribers", &self.subscribers)
            .field("allowed_iata", &self.allowed_iata)
            .field("secondary_iata", &self.secondary_iata)
            .field("allow_test_ingress", &self.allow_test_ingress)
            .field("target_mqtt", &self.target_mqtt)
            .field("meshcore_io", &self.meshcore_io)
            .field("healthcheck", &self.healthcheck)
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ip_network_parse_errors_preserve_the_failure_class() {
        assert!(matches!(
            "not-an-ip".parse::<IpNetwork>(),
            Err(IpNetworkParseError::InvalidAddress { .. })
        ));
        assert!(matches!(
            "127.0.0.1/not-a-prefix".parse::<IpNetwork>(),
            Err(IpNetworkParseError::InvalidPrefix { .. })
        ));
        assert!(matches!(
            "127.0.0.1/33".parse::<IpNetwork>(),
            Err(IpNetworkParseError::PrefixTooLong {
                prefix_len: 33,
                maximum: 32
            })
        ));
    }
}
