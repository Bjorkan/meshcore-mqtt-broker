use super::advert::AdvertError;
use super::types::RadioParams;
use serde_json::Value;

pub(super) const MAX_MQTT_PAYLOAD_BYTES: usize = 16 * 1_024;
const MAX_PACKET_HEX_CHARS: usize = 1_024;

pub(super) struct IngressEntry {
    pub(super) id: u64,
    pub(super) topic: String,
    pub(super) payload: Vec<u8>,
    pub(super) received_at: u64,
    pub(super) expires_at: u64,
    pub(super) processing: bool,
    pub(super) attempts: u8,
    pub(super) retry_at: tokio::time::Instant,
}

#[derive(Debug, thiserror::Error)]
pub(super) enum IngressError {
    #[error("unknown ingress topic")]
    UnknownTopic,
    #[error("unparseable packet ingress")]
    UnparseablePacket,
    #[error(transparent)]
    InvalidAdvert(#[from] AdvertError),
    #[error("invalid radio parameters")]
    InvalidRadioParameters,
    #[error("upload queue at capacity")]
    UploadQueueAtCapacity,
}

impl IngressError {
    pub(super) fn retryable(&self) -> bool {
        matches!(
            self,
            Self::InvalidRadioParameters | Self::UploadQueueAtCapacity
        )
    }
}

#[derive(Clone)]
pub(super) struct ObserverState {
    pub(super) name: Option<String>,
    pub(super) params: RadioParams,
    pub(super) updated_at: u64,
    pub(super) expires_at: u64,
}

pub(super) struct PacketCandidate {
    pub(super) raw_packet: Vec<u8>,
    pub(super) observer_id: String,
}

pub(super) fn relevant_topic(topic: &str) -> bool {
    let parts = topic.split('/').collect::<Vec<_>>();
    parts.len() >= 4 && parts[0] == "meshcore" && matches!(parts[3], "status" | "packets")
}

pub(super) fn is_public_key(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

pub(super) fn sanitize(value: &str, max: usize) -> Option<String> {
    let value = value
        .chars()
        .map(|ch| if ch.is_control() { ' ' } else { ch })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(max)
        .collect::<String>();
    (!value.is_empty()).then_some(value)
}

pub(super) fn packet_candidate(topic: &str, payload: &[u8]) -> Option<PacketCandidate> {
    if payload.len() > MAX_MQTT_PAYLOAD_BYTES {
        return None;
    }
    let value = serde_json::from_slice::<Value>(payload).ok();
    let object = value.as_ref().and_then(Value::as_object);
    let raw = object
        .and_then(|object| {
            ["raw", "packet", "payload", "data"]
                .iter()
                .find_map(|key| object.get(*key)?.as_str())
        })
        .or_else(|| value.as_ref().and_then(Value::as_str))
        .or_else(|| std::str::from_utf8(payload).ok())?;
    let normalized = raw
        .trim()
        .strip_prefix("0x")
        .or_else(|| raw.trim().strip_prefix("0X"))
        .unwrap_or(raw.trim())
        .split_whitespace()
        .collect::<String>()
        .to_ascii_lowercase();
    if normalized.is_empty()
        || normalized.len() > MAX_PACKET_HEX_CHARS
        || normalized.len() % 2 != 0
        || !normalized.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return None;
    }
    let observer_id = object
        .and_then(|object| object.get("origin_id"))
        .and_then(Value::as_str)
        .filter(|value| is_public_key(value))
        .map(str::to_ascii_lowercase)
        .or_else(|| {
            topic
                .split('/')
                .find(|part| is_public_key(part))
                .map(str::to_ascii_lowercase)
        })?;
    Some(PacketCandidate {
        raw_packet: hex::decode(normalized).ok()?,
        observer_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_and_prefixed_packet_hex_are_accepted() {
        let topic = format!("meshcore/STO/{}/packets", "a".repeat(64));
        for payload in [
            b"0200".as_slice(),
            br#"{"raw":"0x0200"}"#,
            br#"{"raw":"0X0200"}"#,
        ] {
            assert_eq!(
                packet_candidate(&topic, payload).unwrap().raw_packet,
                [2, 0]
            );
        }
        assert!(packet_candidate(&topic, b"xyz").is_none());
    }
}
