use crate::error::{ObserverError, ObserverErrorCode as Code};
use base64::Engine;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::Deserialize;

#[derive(Deserialize)]
struct Header {
    alg: String,
    typ: String,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct Claims {
    #[serde(rename = "publicKey")]
    public_key: String,
    pub(super) iat: i64,
    exp: Option<i64>,
    pub(super) aud: Option<String>,
}

pub(super) fn verify_token(
    token: &str,
    expected_key: &str,
    now: i64,
) -> Result<Claims, ObserverError> {
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
