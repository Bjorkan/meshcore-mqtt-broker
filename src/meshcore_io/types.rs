use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct RadioParams {
    pub freq: Option<f64>,
    pub cr: Option<f64>,
    pub sf: Option<f64>,
    pub bw: Option<f64>,
}

impl RadioParams {
    pub(super) fn valid(self) -> bool {
        matches!(self.freq, Some(value) if (100.0..=1_000.0).contains(&value))
            && matches!(self.bw, Some(value) if value > 0.0 && value <= 1_000.0)
            && matches!(self.sf, Some(value) if (5.0..=12.0).contains(&value))
            && matches!(self.cr, Some(value) if (4.0..=8.0).contains(&value))
    }

    pub(super) fn rounded(mut self) -> Self {
        if let Some(freq) = self.freq {
            self.freq = Some((freq * 1_000.0).round() / 1_000.0);
        }
        self
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadJob {
    pub request_id: String,
    pub retries_allowed: u32,
    pub advert_key: String,
    pub advert_timestamp: u32,
    pub advert_type: String,
    pub node_name: String,
    pub node_public_key: String,
    pub raw_packet_hex: String,
    pub observer_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub observer_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latitude: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub longitude: Option<f64>,
    pub radio_params: RadioParams,
    pub enqueued_at: u64,
}

/// A fully classified upload result. The queue never reparses HTTP response
/// text to decide whether a job was accepted or should be retried.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PosterResult {
    Accepted,
    PermanentlyRejected(String),
    Retry(String),
}

#[async_trait]
pub trait MeshcorePoster: Send + Sync {
    async fn post(&self, job: &UploadJob) -> PosterResult;
}

#[derive(Debug, thiserror::Error)]
pub enum MeshcoreIoError {
    #[error("could not build MeshCore.io HTTP client: {0}")]
    HttpClient(#[source] reqwest::Error),
    #[error("meshcore_io.private_key must be hexadecimal")]
    InvalidPrivateKeyHex,
    #[error("meshcore_io.private_key must be 32 or 64 bytes, got {0}")]
    InvalidPrivateKeyLength(usize),
    #[error("meshcore_io.private_key is not a valid clamped expanded key")]
    InvalidExpandedKey,
}
