use crate::config::{Config, SubscriberRole};
use crate::error::{ObserverError, ObserverErrorCode as Code};
use base64::Engine;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use subtle::ConstantTimeEq;

const MAX_FUTURE_IAT_SKEW_SECONDS: i64 = 300;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Principal {
    Publisher {
        public_key: String,
    },
    Subscriber {
        username: String,
        role: SubscriberRole,
    },
}

pub fn principal_from_username(config: &Config, username: &str) -> Option<Principal> {
    if let Some(subscriber) = config.subscribers.get(username) {
        return Some(Principal::Subscriber {
            username: username.to_owned(),
            role: subscriber.role,
        });
    }
    let public_key = username.strip_prefix("v1_")?.trim().to_ascii_uppercase();
    (public_key.len() == 64 && public_key.bytes().all(|value| value.is_ascii_hexdigit()))
        .then_some(Principal::Publisher { public_key })
}

#[derive(Default)]
struct State {
    subscriber_connections: HashMap<String, HashSet<String>>,
}

/// Process-local observer ownership shared between authentication and the
/// broker router. The newest authenticated connection for a public key owns
/// it; a replaced (stale) connection keeps only its own error channel so it
/// can still read its STALE_CONNECTION notice.
#[derive(Clone, Default)]
pub struct ObserverOwnership {
    owners: Arc<Mutex<HashMap<String, String>>>,
}

impl ObserverOwnership {
    pub fn set(&self, public_key: &str, connection_id: &str) {
        self.owners
            .lock()
            .expect("observer ownership lock")
            .insert(public_key.to_owned(), connection_id.to_owned());
    }

    pub fn is_owner(&self, public_key: &str, connection_id: &str) -> bool {
        self.owners
            .lock()
            .expect("observer ownership lock")
            .get(public_key)
            .is_some_and(|owner| owner == connection_id)
    }

    pub fn release(&self, public_key: &str, connection_id: &str) {
        let mut owners = self.owners.lock().expect("observer ownership lock");
        if owners
            .get(public_key)
            .is_some_and(|owner| owner == connection_id)
        {
            owners.remove(public_key);
        }
    }
}

#[derive(Clone)]
pub struct AuthService {
    config: Arc<Config>,
    state: Arc<Mutex<State>>,
    ownership: ObserverOwnership,
}

impl AuthService {
    pub fn new(config: Arc<Config>, ownership: ObserverOwnership) -> Self {
        Self {
            config,
            state: Arc::new(Mutex::new(State::default())),
            ownership,
        }
    }

    pub fn authenticate(
        &self,
        connection_id: &str,
        username: &str,
        password: &[u8],
        now: i64,
    ) -> Result<Principal, ObserverError> {
        if let Some(subscriber) = self.config.subscribers.get(username) {
            let expected = subscriber.password.as_bytes();
            let matches = expected.len() == password.len() && bool::from(expected.ct_eq(password));
            if !matches {
                return Err(ObserverError::new(
                    Code::AuthInvalidPassword,
                    format!("subscriber {username} authentication failed. invalid password."),
                ));
            }
            let mut state = self.state.lock().expect("auth state lock");
            let connections = state
                .subscriber_connections
                .entry(username.to_owned())
                .or_default();
            if !connections.contains(connection_id)
                && connections.len() >= subscriber.max_connections
            {
                return Err(ObserverError::new(
                    Code::SubscriberConnectionLimit,
                    format!(
                        "subscriber connection limit exceeded for {username} ({}/{})",
                        connections.len(),
                        subscriber.max_connections
                    ),
                ));
            }
            connections.insert(connection_id.to_owned());
            return Ok(Principal::Subscriber {
                username: username.to_owned(),
                role: subscriber.role,
            });
        }

        let Some(raw_key) = username.strip_prefix("v1_") else {
            return Err(ObserverError::new(
                Code::AuthInvalidUsernameFormat,
                format!("Username must be v1_<64-hex-public-key>, got {username:?}."),
            ));
        };
        let public_key = raw_key.trim().to_ascii_uppercase();
        if public_key.len() != 64 || !public_key.bytes().all(|v| v.is_ascii_hexdigit()) {
            return Err(ObserverError::new(
                Code::AuthInvalidPublicKey,
                format!(
                    "Username public key must be 64 hex characters, got length {}.",
                    public_key.len()
                ),
            ));
        }
        if password.is_empty() {
            return Err(ObserverError::new(
                Code::AuthMissingToken,
                "Missing auth token: password must be a signed JWT for this public key.",
            ));
        }
        let token = std::str::from_utf8(password)
            .map_err(|_| ObserverError::new(Code::AuthInvalidToken, "Auth token must be UTF-8."))?;
        let claims = verify_token(token, &public_key, now)?;
        if !self.config.expected_audience.is_empty()
            && claims.aud.as_deref() != Some(self.config.expected_audience.as_str())
        {
            return Err(ObserverError::new(
                Code::AuthWrongAudience,
                format!(
                    "Token audience {:?} does not match broker audience {:?}.",
                    claims.aud.unwrap_or_default(),
                    self.config.expected_audience
                ),
            ));
        }
        let stale = claims.iat > now.saturating_add(MAX_FUTURE_IAT_SKEW_SECONDS)
            || self.config.token_max_age_seconds > 0
                && now.saturating_sub(claims.iat) > self.config.token_max_age_seconds;
        if stale {
            return Err(ObserverError::new(
                Code::AuthStaleToken,
                "Auth token is expired or outside the broker clock policy.",
            ));
        }

        self.ownership.set(&public_key, connection_id);
        Ok(Principal::Publisher { public_key })
    }

    pub fn is_observer_owner(&self, public_key: &str, connection_id: &str) -> bool {
        self.ownership.is_owner(public_key, connection_id)
    }

    pub fn release(&self, connection_id: &str, username: &str) {
        let mut state = self.state.lock().expect("auth state lock");
        if let Some(connections) = state.subscriber_connections.get_mut(username) {
            connections.remove(connection_id);
            if connections.is_empty() {
                state.subscriber_connections.remove(username);
            }
        }
        if let Some(Principal::Publisher { public_key }) =
            principal_from_username(&self.config, username)
        {
            self.ownership.release(&public_key, connection_id);
        }
    }
}

#[derive(Deserialize)]
struct Header {
    alg: String,
    typ: String,
}

#[derive(Clone, Debug, Deserialize)]
struct Claims {
    #[serde(rename = "publicKey")]
    public_key: String,
    iat: i64,
    exp: Option<i64>,
    aud: Option<String>,
}

fn verify_token(token: &str, expected_key: &str, now: i64) -> Result<Claims, ObserverError> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        return Err(ObserverError::new(
            Code::AuthInvalidToken,
            "Auth token signature invalid for this public key.",
        ));
    }
    let engine = base64::engine::general_purpose::URL_SAFE_NO_PAD;
    let header: Header = engine
        .decode(parts[0])
        .ok()
        .and_then(|v| serde_json::from_slice(&v).ok())
        .ok_or_else(|| {
            ObserverError::new(Code::AuthInvalidToken, "Auth token header is invalid.")
        })?;
    let claims: Claims = engine
        .decode(parts[1])
        .ok()
        .and_then(|v| serde_json::from_slice(&v).ok())
        .ok_or_else(|| {
            ObserverError::new(Code::AuthInvalidToken, "Auth token payload is invalid.")
        })?;
    if claims.public_key.eq_ignore_ascii_case(expected_key)
        && claims.exp.is_some_and(|exp| now > exp)
    {
        return Err(ObserverError::new(
            Code::AuthStaleToken,
            "Auth token is expired.",
        ));
    }
    if header.alg != "Ed25519"
        || header.typ != "JWT"
        || !claims.public_key.eq_ignore_ascii_case(expected_key)
    {
        return Err(ObserverError::new(
            Code::AuthInvalidToken,
            "Auth token signature invalid for this public key.",
        ));
    }
    let key: [u8; 32] = hex::decode(expected_key)
        .ok()
        .and_then(|v| v.try_into().ok())
        .ok_or_else(|| ObserverError::new(Code::AuthInvalidPublicKey, "Invalid public key."))?;
    let signature_bytes: [u8; 64] = hex::decode(parts[2])
        .ok()
        .and_then(|v| v.try_into().ok())
        .ok_or_else(|| {
            ObserverError::new(
                Code::AuthInvalidToken,
                "Auth token signature invalid for this public key.",
            )
        })?;
    let verifying_key = VerifyingKey::from_bytes(&key).map_err(|_| {
        ObserverError::new(Code::AuthInvalidPublicKey, "Invalid Ed25519 public key.")
    })?;
    verifying_key
        .verify(
            format!("{}.{}", parts[0], parts[1]).as_bytes(),
            &Signature::from_bytes(&signature_bytes),
        )
        .map_err(|_| {
            ObserverError::new(
                Code::AuthInvalidToken,
                "Auth token signature invalid for this public key.",
            )
        })?;
    Ok(claims)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Subscriber, SubscriberRole};
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use ed25519_dalek::{Signer, SigningKey};
    use std::net::SocketAddr;
    fn config() -> Arc<Config> {
        Arc::new(Config {
            listener: "127.0.0.1:0".parse::<SocketAddr>().unwrap(),
            trusted_proxies: Vec::new(),
            ws_max_payload_bytes: 65536,
            json_publish_max_bytes: 8192,
            broker_name: "test".into(),
            expected_audience: "aud".into(),
            token_max_age_seconds: 0,
            subscribers: HashMap::from([(
                "viewer".into(),
                Subscriber {
                    password: "secret".into(),
                    role: SubscriberRole::Limited,
                    max_connections: 1,
                },
            )]),
            allowed_iata: HashSet::from(["STO".into()]),
            secondary_iata: HashMap::new(),
            allow_test_ingress: false,
            target_mqtt: Default::default(),
            meshcore_io: Default::default(),
            healthcheck: crate::config::HealthcheckConfig {
                url: "http://127.0.0.1:8883/status".into(),
                timeout_ms: 8_000,
            },
        })
    }
    #[test]
    fn subscriber_password_and_limit_are_enforced() {
        let auth = AuthService::new(config(), ObserverOwnership::default());
        assert_eq!(
            auth.authenticate("one", "viewer", b"secret", 0).unwrap(),
            Principal::Subscriber {
                username: "viewer".into(),
                role: SubscriberRole::Limited
            }
        );
        assert_eq!(
            auth.authenticate("two", "viewer", b"secret", 0)
                .unwrap_err()
                .code,
            Code::SubscriberConnectionLimit
        );
        auth.release("one", "viewer");
        assert!(auth.authenticate("two", "viewer", b"secret", 0).is_ok());
        assert_eq!(
            auth.authenticate("bad", "viewer", b"secrex", 0)
                .unwrap_err()
                .code,
            Code::AuthInvalidPassword
        );
    }

    fn observer_token(now: i64) -> (String, String) {
        observer_token_with_claims(now, None)
    }

    fn observer_token_with_claims(iat: i64, exp: Option<i64>) -> (String, String) {
        let signing_key = SigningKey::from_bytes(&[7; 32]);
        let public_key = hex::encode_upper(signing_key.verifying_key().to_bytes());
        let header = URL_SAFE_NO_PAD.encode(br#"{"alg":"Ed25519","typ":"JWT"}"#);
        let expiration = exp.map_or_else(String::new, |value| format!(",\"exp\":{value}"));
        let payload = URL_SAFE_NO_PAD.encode(
            format!(r#"{{"publicKey":"{public_key}","iat":{iat}{expiration},"aud":"aud"}}"#)
                .as_bytes(),
        );
        let input = format!("{header}.{payload}");
        let signature = signing_key.sign(input.as_bytes());
        (
            public_key,
            format!("{input}.{}", hex::encode_upper(signature.to_bytes())),
        )
    }

    #[test]
    fn newer_observer_connection_owns_the_key_and_old_release_cannot_erase_it() {
        let auth = AuthService::new(config(), ObserverOwnership::default());
        let (public_key, token) = observer_token(1_000);
        let username = format!("v1_{public_key}");

        assert!(
            auth.authenticate("old-socket", &username, token.as_bytes(), 1_000)
                .is_ok()
        );
        assert!(auth.is_observer_owner(&public_key, "old-socket"));

        assert!(
            auth.authenticate("new-socket", &username, token.as_bytes(), 1_000)
                .is_ok()
        );
        assert!(!auth.is_observer_owner(&public_key, "old-socket"));
        assert!(auth.is_observer_owner(&public_key, "new-socket"));

        auth.release("old-socket", &username);
        assert!(auth.is_observer_owner(&public_key, "new-socket"));
        auth.release("new-socket", &username);
        assert!(!auth.is_observer_owner(&public_key, "new-socket"));
    }

    #[test]
    fn token_time_boundaries_never_overflow_and_apply_clock_policy() {
        let mut bounded = (*config()).clone();
        bounded.token_max_age_seconds = 60;
        let auth = AuthService::new(Arc::new(bounded), ObserverOwnership::default());

        let (key, token) = observer_token_with_claims(i64::MIN, None);
        assert_eq!(
            auth.authenticate("ancient", &format!("v1_{key}"), token.as_bytes(), 0)
                .unwrap_err()
                .code,
            Code::AuthStaleToken
        );

        let (key, token) = observer_token_with_claims(i64::MAX, None);
        assert_eq!(
            auth.authenticate("future", &format!("v1_{key}"), token.as_bytes(), 0)
                .unwrap_err()
                .code,
            Code::AuthStaleToken
        );

        let (key, token) = observer_token_with_claims(i64::MAX, Some(i64::MAX));
        assert!(
            auth.authenticate("maximum", &format!("v1_{key}"), token.as_bytes(), i64::MAX)
                .is_ok()
        );

        let (key, token) = observer_token_with_claims(0, Some(-1));
        assert_eq!(
            auth.authenticate("expired", &format!("v1_{key}"), token.as_bytes(), 0)
                .unwrap_err()
                .code,
            Code::AuthStaleToken
        );
    }
}
