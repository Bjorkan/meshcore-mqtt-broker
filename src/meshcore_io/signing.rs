use super::types::{MeshcoreIoError, RadioParams, UploadJob};
use curve25519_dalek::constants::ED25519_BASEPOINT_POINT;
use curve25519_dalek::scalar::Scalar;
use ed25519_dalek::{Signer, SigningKey};
use serde::Serialize;
use sha2::{Digest, Sha256, Sha512};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SignedRequest {
    pub(super) data: String,
    pub(super) signature: String,
    #[serde(rename = "publicKey")]
    pub(super) public_key: String,
}

#[derive(Serialize)]
struct UploadData<'a> {
    params: RadioParams,
    links: [&'a str; 1],
}

enum SigningMaterial {
    Seed(SigningKey),
    Expanded {
        scalar: Scalar,
        nonce_prefix: [u8; 32],
        public_key: [u8; 32],
    },
}

pub(super) struct SigningIdentity {
    material: SigningMaterial,
    public_key: [u8; 32],
}

impl SigningIdentity {
    pub(super) fn new(configured: Option<&str>) -> Result<Self, MeshcoreIoError> {
        let key = if let Some(configured) = configured {
            hex::decode(configured).map_err(|_| MeshcoreIoError::InvalidPrivateKeyHex)?
        } else {
            rand::random::<[u8; 32]>().to_vec()
        };
        let (material, public_key) = match key.len() {
            32 => {
                let seed: [u8; 32] = key.try_into().expect("length checked");
                let signing = SigningKey::from_bytes(&seed);
                let public = signing.verifying_key().to_bytes();
                (SigningMaterial::Seed(signing), public)
            }
            64 => {
                let expanded: [u8; 64] = key.try_into().expect("length checked");
                if expanded[0] & 7 != 0 || expanded[31] & 0xc0 != 0x40 {
                    return Err(MeshcoreIoError::InvalidExpandedKey);
                }
                let scalar = Scalar::from_bytes_mod_order(expanded[..32].try_into().unwrap());
                let public = (ED25519_BASEPOINT_POINT * scalar).compress().to_bytes();
                (
                    SigningMaterial::Expanded {
                        scalar,
                        nonce_prefix: expanded[32..].try_into().unwrap(),
                        public_key: public,
                    },
                    public,
                )
            }
            length => return Err(MeshcoreIoError::InvalidPrivateKeyLength(length)),
        };
        tracing::info!(public_key = %hex::encode(public_key), "MeshCore.io signing identity ready");
        Ok(Self {
            material,
            public_key,
        })
    }

    pub(super) fn signed_request(&self, job: &UploadJob) -> Result<SignedRequest, String> {
        if !job.radio_params.valid() {
            return Err("invalid radio parameters".into());
        }
        let link = format!("meshcore://{}", job.raw_packet_hex);
        let data = serde_json::to_string(&UploadData {
            params: job.radio_params.rounded(),
            links: [&link],
        })
        .map_err(|error| error.to_string())?;
        let digest: [u8; 32] = Sha256::digest(data.as_bytes()).into();
        let signature = match &self.material {
            SigningMaterial::Seed(key) => key.sign(&digest).to_bytes(),
            SigningMaterial::Expanded {
                scalar,
                nonce_prefix,
                public_key,
            } => sign_expanded(&digest, scalar, nonce_prefix, public_key),
        };
        Ok(SignedRequest {
            data,
            signature: hex::encode(signature),
            public_key: hex::encode(self.public_key),
        })
    }
}

fn sign_expanded(
    message: &[u8],
    scalar: &Scalar,
    nonce_prefix: &[u8; 32],
    public_key: &[u8; 32],
) -> [u8; 64] {
    let nonce_digest: [u8; 64] = Sha512::new()
        .chain_update(nonce_prefix)
        .chain_update(message)
        .finalize()
        .into();
    let nonce = Scalar::from_bytes_mod_order_wide(&nonce_digest);
    let encoded_r = (ED25519_BASEPOINT_POINT * nonce).compress().to_bytes();
    let challenge_digest: [u8; 64] = Sha512::new()
        .chain_update(encoded_r)
        .chain_update(public_key)
        .chain_update(message)
        .finalize()
        .into();
    let challenge = Scalar::from_bytes_mod_order_wide(&challenge_digest);
    let encoded_s = (nonce + challenge * scalar).to_bytes();
    let mut signature = [0_u8; 64];
    signature[..32].copy_from_slice(&encoded_r);
    signature[32..].copy_from_slice(&encoded_s);
    signature
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};

    fn job() -> UploadJob {
        UploadJob {
            request_id: "request".into(),
            retries_allowed: 2,
            advert_key: "advert".into(),
            advert_timestamp: 100,
            advert_type: "REPEATER".into(),
            node_name: "Node".into(),
            node_public_key: "a".repeat(64),
            raw_packet_hex: "00".into(),
            observer_id: "b".repeat(64),
            observer_name: None,
            latitude: None,
            longitude: None,
            radio_params: RadioParams {
                freq: Some(869.525),
                cr: Some(5.0),
                sf: Some(11.0),
                bw: Some(125.0),
            },
            enqueued_at: 0,
        }
    }

    #[test]
    fn seed_and_expanded_keys_keep_the_typescript_wire_signature() {
        let seed = [9_u8; 32];
        let mut expanded: [u8; 64] = Sha512::digest(seed).into();
        expanded[0] &= 248;
        expanded[31] &= 63;
        expanded[31] |= 64;
        for key in [hex::encode(seed), hex::encode(expanded)] {
            let identity = SigningIdentity::new(Some(&key)).unwrap();
            let request = identity.signed_request(&job()).unwrap();
            let object = serde_json::to_value(&request).unwrap();
            assert_eq!(
                object
                    .as_object()
                    .unwrap()
                    .keys()
                    .cloned()
                    .collect::<std::collections::BTreeSet<_>>(),
                ["data", "publicKey", "signature"].map(str::to_owned).into()
            );
            let public: [u8; 32] = hex::decode(&request.public_key)
                .unwrap()
                .try_into()
                .unwrap();
            let signature =
                Signature::from_slice(&hex::decode(request.signature).unwrap()).unwrap();
            let digest = Sha256::digest(request.data.as_bytes());
            VerifyingKey::from_bytes(&public)
                .unwrap()
                .verify(&digest, &signature)
                .unwrap();
        }
    }

    #[test]
    fn invalid_key_material_has_typed_errors() {
        assert!(matches!(
            SigningIdentity::new(Some("not-hex")),
            Err(MeshcoreIoError::InvalidPrivateKeyHex)
        ));
        assert!(matches!(
            SigningIdentity::new(Some(&hex::encode([1_u8; 64]))),
            Err(MeshcoreIoError::InvalidExpandedKey)
        ));
    }
}
