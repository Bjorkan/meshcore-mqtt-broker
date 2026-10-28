use crate::config::MeshcoreIoConfig;
use async_trait::async_trait;
use curve25519_dalek::constants::ED25519_BASEPOINT_POINT;
use curve25519_dalek::scalar::Scalar;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use futures_util::StreamExt;
use indexmap::IndexMap;
use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256, Sha512};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::Notify;
use tokio::task::JoinHandle;

const MAX_RESPONSE_BYTES: usize = 64 * 1_024;
const MAX_DIAGNOSTIC_CHARS: usize = 2_000;
const MAX_MQTT_PAYLOAD_BYTES: usize = 16 * 1_024;
const MAX_PACKET_HEX_CHARS: usize = 1_024;
const INGRESS_RETENTION_MS: u64 = 24 * 60 * 60 * 1_000;
const OBSERVER_TTL_MS: u64 = 24 * 60 * 60 * 1_000;
const SEEN_ADVERT_TTL_MS: u64 = 72 * 60 * 60 * 1_000;
const VALID_ADVERT_COOLDOWN_MS: u64 = 60 * 60 * 1_000;
const MAX_INGRESS_DEDUP_ENTRIES: usize = 50_000;
const MAX_OBSERVER_ENTRIES: usize = 10_000;
const MAX_NODE_ENTRIES: usize = 50_000;
const MAX_INGRESS_ATTEMPTS: u8 = 5;
/// Mirrors the legacy ingress loop: failed attempts wait ~1 s before the
/// next try instead of hammering the processor on every poll.
const INGRESS_RETRY_DELAY_MS: u64 = 1_000;
const STATE_SWEEP_INTERVAL: Duration = Duration::from_secs(60);

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct RadioParams {
    pub freq: Option<f64>,
    pub cr: Option<f64>,
    pub sf: Option<f64>,
    pub bw: Option<f64>,
}

impl RadioParams {
    fn valid(self) -> bool {
        matches!(self.freq, Some(value) if (100.0..=1_000.0).contains(&value))
            && matches!(self.bw, Some(value) if value > 0.0 && value <= 1_000.0)
            && matches!(self.sf, Some(value) if (5.0..=12.0).contains(&value))
            && matches!(self.cr, Some(value) if (4.0..=8.0).contains(&value))
    }

    fn rounded(mut self) -> Self {
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

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PosterResult {
    Handled(Option<String>),
    Retry(String),
}

#[async_trait]
pub trait MeshcorePoster: Send + Sync {
    async fn post(&self, job: &UploadJob) -> PosterResult;
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SignedRequest {
    data: String,
    signature: String,
    /// MeshCore.io expects the exact TypeScript field name `publicKey`
    /// (see `SignedRequest` in the legacy meshcore-io-poster.ts). The
    /// rename is explicit so the wire schema cannot drift with future
    /// `rename_all` changes.
    #[serde(rename = "publicKey")]
    public_key: String,
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

pub struct HttpMeshcorePoster {
    config: MeshcoreIoConfig,
    client: reqwest::Client,
    signing: SigningMaterial,
    public_key: [u8; 32],
}

impl HttpMeshcorePoster {
    pub fn new(config: MeshcoreIoConfig) -> Result<Self, String> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(config.request_timeout_ms))
            .build()
            .map_err(|error| error.to_string())?;
        let key = if let Some(configured) = config.private_key.as_deref() {
            hex::decode(configured).map_err(|_| "invalid meshcore_io.private_key".to_owned())?
        } else {
            rand::random::<[u8; 32]>().to_vec()
        };
        let (signing, public_key) = match key.len() {
            32 => {
                let seed: [u8; 32] = key.try_into().expect("length checked");
                let signing = SigningKey::from_bytes(&seed);
                let public = signing.verifying_key().to_bytes();
                (SigningMaterial::Seed(signing), public)
            }
            64 => {
                let expanded: [u8; 64] = key.try_into().expect("length checked");
                if expanded[0] & 7 != 0 || expanded[31] & 0xc0 != 0x40 {
                    return Err(
                        "meshcore_io.private_key is not a valid clamped expanded key".into(),
                    );
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
            _ => return Err("meshcore_io.private_key must be 32 or 64 bytes".into()),
        };
        tracing::info!(public_key = %hex::encode(public_key), "MeshCore.io signing identity ready");
        Ok(Self {
            config,
            client,
            signing,
            public_key,
        })
    }

    fn signed_request(&self, job: &UploadJob) -> Result<SignedRequest, String> {
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
        let signature = match &self.signing {
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

#[async_trait]
impl MeshcorePoster for HttpMeshcorePoster {
    async fn post(&self, job: &UploadJob) -> PosterResult {
        let request = match self.signed_request(job) {
            Ok(request) => request,
            Err(error) => return PosterResult::Handled(Some(error)),
        };
        if self.config.dry_run {
            return PosterResult::Handled(Some("dry-run".into()));
        }
        let response = match self
            .client
            .post(&self.config.api_url)
            .json(&request)
            .send()
            .await
        {
            Ok(response) => response,
            Err(error) => return PosterResult::Retry(format_error(&error.to_string())),
        };
        let status = response.status();
        if response
            .content_length()
            .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
        {
            return PosterResult::Retry("Meshcore.io response body exceeds 64 KiB".into());
        }
        let mut stream = response.bytes_stream();
        let mut body = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = match chunk {
                Ok(chunk) => chunk,
                Err(error) => return PosterResult::Retry(format_error(&error.to_string())),
            };
            if body.len() + chunk.len() > MAX_RESPONSE_BYTES {
                return PosterResult::Retry("Meshcore.io response body exceeds 64 KiB".into());
            }
            body.extend_from_slice(&chunk);
        }
        let text = String::from_utf8_lossy(&body).into_owned();
        let code = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|value| value.get("code")?.as_str().map(str::to_owned));
        let terminal_code = code.as_deref().is_some_and(|code| {
            code == "NODES_INSERTED"
                || code.starts_with("ERR_ADVERT_")
                || code.starts_with("ERR_COORDS_")
        });
        let handled = status.is_success()
            || terminal_code
            || status.is_client_error() && status.as_u16() != 408 && status.as_u16() != 429;
        let response_text = if text.is_empty() {
            format!("HTTP {}", status.as_u16())
        } else {
            text
        };
        if handled {
            PosterResult::Handled(Some(response_text))
        } else {
            PosterResult::Retry(format!(
                "meshcore.io responded HTTP {}{}",
                status.as_u16(),
                diagnostic(&response_text)
                    .is_empty()
                    .then(String::new)
                    .unwrap_or_else(|| format!(": {}", diagnostic(&response_text)))
            ))
        }
    }
}

fn diagnostic(value: &str) -> String {
    value
        .replace(['\r', '\n', '\t'], " ")
        .trim()
        .chars()
        .take(MAX_DIAGNOSTIC_CHARS)
        .collect()
}

fn format_error(value: &str) -> String {
    let value: String = value
        .replace(['\r', '\n', '\t'], " ")
        .trim()
        .chars()
        .take(500)
        .collect();
    if value.is_empty() {
        "okänt fel".into()
    } else {
        value
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct QueueStats {
    pub ingress_pending: usize,
    pub jobs_pending: usize,
    pub jobs_processing: usize,
    pub jobs_retrying: usize,
    pub dedup_entries: usize,
    pub observer_entries: usize,
    pub node_entries: usize,
    pub completed_uploads: u64,
    pub dropped_uploads: u64,
}

#[derive(Clone)]
pub struct MeshcoreIoRuntime {
    inner: Arc<RuntimeInner>,
}

struct RuntimeInner {
    config: MeshcoreIoConfig,
    poster: Arc<dyn MeshcorePoster>,
    state: Mutex<RuntimeState>,
    notify: Notify,
    shutdown: Notify,
    stopped: AtomicBool,
    tasks: Mutex<Vec<JoinHandle<()>>>,
}

#[derive(Default)]
struct RuntimeState {
    ingress: VecDeque<IngressEntry>,
    dedup: IndexMap<[u8; 32], u64>,
    observer_radio: IndexMap<String, ObserverState>,
    jobs: Vec<JobRow>,
    node_state: IndexMap<String, NodeState>,
    next_ingress_id: u64,
    next_job_id: u64,
    completed_uploads: u64,
    dropped_uploads: u64,
}

struct IngressEntry {
    id: u64,
    topic: String,
    payload: Vec<u8>,
    received_at: u64,
    expires_at: u64,
    processing: bool,
    attempts: u8,
    retry_at: tokio::time::Instant,
}

/// Why an ingress attempt failed: transient failures (waiting for radio
/// state, unparseable payloads) are retried with backoff, permanent ones
/// are dropped immediately.
enum IngressError {
    Retry(String),
    Terminal(String),
}

#[derive(Clone)]
struct ObserverState {
    name: Option<String>,
    params: RadioParams,
    updated_at: u64,
    expires_at: u64,
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum JobStatus {
    Pending,
    Processing,
    Retry,
}

#[derive(Clone)]
struct JobRow {
    id: u64,
    job: UploadJob,
    status: JobStatus,
    next_attempt_at: u64,
    attempt_count: u32,
}

#[derive(Clone, Default)]
struct NodeState {
    cooldown_until: Option<u64>,
    accepted_timestamp: Option<u32>,
    accepted_expires_at: Option<u64>,
}

impl MeshcoreIoRuntime {
    pub fn start(config: MeshcoreIoConfig) -> Result<Option<Self>, String> {
        if !config.enabled {
            return Ok(None);
        }
        let poster = Arc::new(HttpMeshcorePoster::new(config.clone())?);
        Ok(Some(Self::with_poster(config, poster, true)))
    }

    pub fn with_poster(
        config: MeshcoreIoConfig,
        poster: Arc<dyn MeshcorePoster>,
        start_workers: bool,
    ) -> Self {
        let runtime = Self {
            inner: Arc::new(RuntimeInner {
                config,
                poster,
                state: Mutex::new(RuntimeState::default()),
                notify: Notify::new(),
                shutdown: Notify::new(),
                stopped: AtomicBool::new(false),
                tasks: Mutex::new(Vec::new()),
            }),
        };
        if start_workers {
            let cleanup = runtime.clone();
            runtime
                .inner
                .tasks
                .lock()
                .unwrap()
                .push(tokio::spawn(async move { cleanup.cleanup_loop().await }));
            let ingress = runtime.clone();
            runtime
                .inner
                .tasks
                .lock()
                .unwrap()
                .push(tokio::spawn(async move { ingress.ingress_loop().await }));
            for _ in 0..runtime.inner.config.workers {
                let worker = runtime.clone();
                runtime
                    .inner
                    .tasks
                    .lock()
                    .unwrap()
                    .push(tokio::spawn(async move { worker.worker_loop().await }));
            }
        }
        runtime
    }

    pub fn offer_publish(&self, topic: &str, payload: &[u8]) {
        if self.inner.stopped.load(Ordering::Acquire) || !relevant_topic(topic) {
            return;
        }
        let now = now_ms();
        let digest: [u8; 32] = Sha256::new()
            .chain_update(topic.as_bytes())
            .chain_update([0])
            .chain_update(payload)
            .finalize()
            .into();
        let mut state = self.inner.state.lock().unwrap();
        if let Some(expires) = state.dedup.get(&digest).copied() {
            if expires > now {
                return;
            }
            state.dedup.shift_remove(&digest);
        }
        state
            .dedup
            .insert(digest, now + self.inner.config.ingress_dedup_ms);
        while state.dedup.len() > MAX_INGRESS_DEDUP_ENTRIES {
            state.dedup.shift_remove_index(0);
        }
        let max_ingress = 10_000.max(self.inner.config.max_queued_uploads.saturating_mul(20));
        if state.ingress.len() >= max_ingress {
            tracing::warn!(topic, "MeshCore.io ingress full; message dropped");
            return;
        }
        state.next_ingress_id += 1;
        let id = state.next_ingress_id;
        state.ingress.push_back(IngressEntry {
            id,
            topic: topic.into(),
            payload: payload.to_vec(),
            received_at: now,
            expires_at: now + INGRESS_RETENTION_MS,
            processing: false,
            attempts: 0,
            retry_at: tokio::time::Instant::now(),
        });
        drop(state);
        self.inner.notify.notify_waiters();
    }

    pub fn stats(&self) -> QueueStats {
        let now = now_ms();
        let state = self.inner.state.lock().unwrap();
        QueueStats {
            ingress_pending: state
                .ingress
                .iter()
                .filter(|row| row.expires_at > now)
                .count(),
            jobs_pending: state
                .jobs
                .iter()
                .filter(|row| row.status == JobStatus::Pending)
                .count(),
            jobs_processing: state
                .jobs
                .iter()
                .filter(|row| row.status == JobStatus::Processing)
                .count(),
            jobs_retrying: state
                .jobs
                .iter()
                .filter(|row| row.status == JobStatus::Retry)
                .count(),
            dedup_entries: state
                .dedup
                .values()
                .filter(|expires| **expires > now)
                .count(),
            observer_entries: state
                .observer_radio
                .values()
                .filter(|row| row.expires_at > now)
                .count(),
            node_entries: state
                .node_state
                .values()
                .filter(|row| node_state_live(row, now))
                .count(),
            completed_uploads: state.completed_uploads,
            dropped_uploads: state.dropped_uploads,
        }
    }

    pub async fn stop(&self) {
        if self.inner.stopped.swap(true, Ordering::AcqRel) {
            return;
        }
        self.inner.notify.notify_waiters();
        self.inner.shutdown.notify_waiters();
        let tasks = std::mem::take(&mut *self.inner.tasks.lock().unwrap());
        for task in tasks {
            let _ = task.await;
        }
    }

    async fn ingress_loop(self) {
        while !self.inner.stopped.load(Ordering::Acquire) {
            let claimed = {
                let now = now_ms();
                let mut state = self.inner.state.lock().unwrap();
                state
                    .ingress
                    .iter_mut()
                    .find(|row| {
                        !row.processing
                            && row.expires_at > now
                            && row.retry_at <= tokio::time::Instant::now()
                    })
                    .map(|row| {
                        row.processing = true;
                        (
                            row.id,
                            row.topic.clone(),
                            row.payload.clone(),
                            row.received_at,
                        )
                    })
            };
            let Some((id, topic, payload, received_at)) = claimed else {
                tokio::select! {
                    _ = self.inner.notify.notified() => {}
                    _ = self.inner.shutdown.notified() => {}
                    _ = tokio::time::sleep(Duration::from_millis(250)) => {}
                }
                continue;
            };
            let result = self.process_ingress(&topic, &payload, received_at);
            let mut state = self.inner.state.lock().unwrap();
            let Some(index) = state.ingress.iter().position(|row| row.id == id) else {
                continue;
            };
            match result {
                Ok(()) => {
                    state.ingress.remove(index);
                }
                Err(IngressError::Terminal(reason)) => {
                    state.ingress.remove(index);
                    tracing::warn!(topic, reason = %format_error(&reason), "MeshCore.io ingress entry dropped permanently");
                }
                Err(IngressError::Retry(_reason)) => {
                    let row = &mut state.ingress[index];
                    row.processing = false;
                    row.attempts += 1;
                    if row.attempts >= MAX_INGRESS_ATTEMPTS {
                        let topic = row.topic.clone();
                        state.ingress.remove(index);
                        tracing::warn!(
                            topic,
                            "MeshCore.io ingress entry dropped after {MAX_INGRESS_ATTEMPTS} attempts"
                        );
                    } else {
                        // Back off ~1 s between attempts, like the legacy
                        // ingress loop, so a status message arriving shortly
                        // after its packet has time to be processed first.
                        row.retry_at = tokio::time::Instant::now()
                            + Duration::from_millis(INGRESS_RETRY_DELAY_MS);
                    }
                }
            }
        }
    }

    async fn cleanup_loop(self) {
        let mut interval = tokio::time::interval(STATE_SWEEP_INTERVAL);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        // Tokio intervals tick immediately once. Consume that tick so the
        // first cleanup is periodic rather than racing startup inserts.
        interval.tick().await;
        loop {
            if self.inner.stopped.load(Ordering::Acquire) {
                return;
            }
            tokio::select! {
                _ = interval.tick() => {
                    let mut state = self.inner.state.lock().unwrap();
                    sweep_state(&mut state, now_ms());
                }
                _ = self.inner.shutdown.notified() => return,
            }
        }
    }

    fn process_ingress(
        &self,
        topic: &str,
        payload: &[u8],
        received_at: u64,
    ) -> Result<(), IngressError> {
        let subtopic = topic.split('/').nth(3).unwrap_or_default();
        if subtopic == "status" {
            self.remember_status(topic, payload, received_at);
            return Ok(());
        }
        if subtopic != "packets" {
            return Err(IngressError::Terminal("unknown ingress topic".into()));
        }
        let candidate = packet_candidate(topic, payload)
            .ok_or_else(|| IngressError::Retry("unparseable packet ingress".into()))?;
        if !is_advert_packet(&candidate.raw_packet) {
            return Ok(());
        }
        let advert = parse_advert_packet(&candidate.raw_packet)?;
        if !matches!(advert.advert_type.as_str(), "REPEATER" | "ROOM" | "SENSOR") {
            return Ok(());
        }
        advert.verify().map_err(IngressError::Retry)?;
        let state = self.inner.state.lock().unwrap();
        let observer = state
            .observer_radio
            .get(&candidate.observer_id)
            .filter(|row| row.expires_at > now_ms())
            .cloned();
        drop(state);
        let params = observer
            .as_ref()
            .map(|row| row.params)
            .unwrap_or_default()
            .rounded();
        if !params.valid() {
            return Err(IngressError::Retry("invalid radio parameters".into()));
        }
        let job = UploadJob {
            request_id: uuid::Uuid::new_v4().to_string(),
            retries_allowed: self.inner.config.attempts,
            advert_key: format!("{}:{}", advert.public_key, advert.timestamp),
            advert_timestamp: advert.timestamp,
            advert_type: advert.advert_type,
            node_name: advert
                .name
                .unwrap_or_else(|| advert.public_key[..8].to_owned()),
            node_public_key: advert.public_key,
            raw_packet_hex: hex::encode(candidate.raw_packet),
            observer_id: candidate.observer_id,
            observer_name: observer.and_then(|row| row.name),
            latitude: advert.latitude,
            longitude: advert.longitude,
            radio_params: params,
            enqueued_at: now_ms(),
        };
        self.admit_job(job);
        Ok(())
    }

    fn remember_status(&self, topic: &str, payload: &[u8], received_at: u64) {
        let Ok(value) = serde_json::from_slice::<Value>(payload) else {
            return;
        };
        let Some(object) = value.as_object() else {
            return;
        };
        let observer_id = object
            .get("origin_id")
            .and_then(Value::as_str)
            .filter(|value| is_public_key(value))
            .map(|value| value.to_ascii_lowercase())
            .or_else(|| {
                topic
                    .split('/')
                    .find(|part| is_public_key(part))
                    .map(str::to_ascii_lowercase)
            });
        let Some(observer_id) = observer_id else {
            return;
        };
        let params = parse_radio_params(object);
        if !params.valid() {
            return;
        }
        let name = object
            .get("origin")
            .and_then(Value::as_str)
            .and_then(|value| sanitize(value, 200));
        let mut state = self.inner.state.lock().unwrap();
        if state
            .observer_radio
            .get(&observer_id)
            .is_some_and(|current| current.updated_at >= received_at)
        {
            return;
        }
        state.observer_radio.insert(
            observer_id,
            ObserverState {
                name,
                params,
                updated_at: received_at,
                expires_at: received_at + OBSERVER_TTL_MS,
            },
        );
        while state.observer_radio.len() > MAX_OBSERVER_ENTRIES {
            state.observer_radio.shift_remove_index(0);
        }
    }

    pub fn admit_job(&self, job: UploadJob) {
        let now = now_ms();
        let mut state = self.inner.state.lock().unwrap();
        let node = state
            .node_state
            .get(&job.node_public_key)
            .cloned()
            .unwrap_or_default();
        if node
            .accepted_expires_at
            .is_some_and(|expires| expires > now)
            && let Some(previous) = node.accepted_timestamp
            && (previous >= job.advert_timestamp
                || job.advert_timestamp
                    < previous.saturating_add(self.inner.config.min_reupload_seconds as u32))
        {
            return;
        }
        if node.cooldown_until.is_some_and(|until| until > now)
            || state
                .jobs
                .iter()
                .any(|row| row.job.node_public_key == job.node_public_key)
            || state.jobs.len() >= self.inner.config.max_queued_uploads
        {
            return;
        }
        state.next_job_id += 1;
        let id = state.next_job_id;
        state.jobs.push(JobRow {
            id,
            job: job.clone(),
            status: JobStatus::Pending,
            next_attempt_at: now,
            attempt_count: 0,
        });
        state.node_state.insert(
            job.node_public_key,
            NodeState {
                cooldown_until: Some(now + VALID_ADVERT_COOLDOWN_MS),
                ..node
            },
        );
        while state.node_state.len() > MAX_NODE_ENTRIES {
            state.node_state.shift_remove_index(0);
        }
        drop(state);
        self.inner.notify.notify_waiters();
    }

    async fn worker_loop(self) {
        while !self.inner.stopped.load(Ordering::Acquire) {
            let row = self.claim_job();
            let Some(row) = row else {
                tokio::select! {
                    _ = self.inner.notify.notified() => {}
                    _ = self.inner.shutdown.notified() => {}
                    _ = tokio::time::sleep(Duration::from_millis(250)) => {}
                }
                continue;
            };
            self.process_job(row).await;
        }
    }

    fn claim_job(&self) -> Option<JobRow> {
        let now = now_ms();
        let mut state = self.inner.state.lock().unwrap();
        let index = state
            .jobs
            .iter()
            .enumerate()
            .filter(|(_, row)| {
                matches!(row.status, JobStatus::Pending | JobStatus::Retry)
                    && row.next_attempt_at <= now
            })
            .min_by_key(|(_, row)| (row.next_attempt_at, row.id))
            .map(|(index, _)| index)?;
        state.jobs[index].status = JobStatus::Processing;
        state.jobs[index].attempt_count += 1;
        Some(state.jobs[index].clone())
    }

    async fn process_job(&self, row: JobRow) {
        if row.attempt_count > row.job.retries_allowed.max(1) {
            self.finish_dropped(row.id, "attempt limit reached");
            return;
        }
        let result = tokio::select! {
            result = self.inner.poster.post(&row.job) => result,
            _ = self.inner.shutdown.notified() => return,
        };
        match result {
            PosterResult::Handled(response) => self.finish_completed(row.id, &row.job, response),
            PosterResult::Retry(_error) if row.attempt_count < row.job.retries_allowed.max(1) => {
                self.schedule_retry(row.id)
            }
            PosterResult::Retry(error) => self.finish_dropped(row.id, &error),
        }
    }

    fn schedule_retry(&self, id: u64) {
        let now = now_ms();
        let mut state = self.inner.state.lock().unwrap();
        let Some(row) = state
            .jobs
            .iter_mut()
            .find(|row| row.id == id && row.status == JobStatus::Processing)
        else {
            return;
        };
        let base = self.inner.config.retry_delay_ms;
        let backoff = base
            .saturating_mul(2_u64.saturating_pow(row.attempt_count.saturating_sub(1)))
            .min(300_000);
        let jitter_max = 1_000.min(backoff / 4 + 1);
        let jitter = if jitter_max == 0 {
            0
        } else {
            rand::rng().random_range(0..jitter_max)
        };
        row.status = JobStatus::Retry;
        row.next_attempt_at = now + backoff + jitter;
    }

    fn finish_completed(&self, id: u64, job: &UploadJob, response: Option<String>) {
        let now = now_ms();
        let mut state = self.inner.state.lock().unwrap();
        let Some(index) = state
            .jobs
            .iter()
            .position(|row| row.id == id && row.status == JobStatus::Processing)
        else {
            return;
        };
        state.jobs.remove(index);
        state.completed_uploads += 1;
        let accepted = response.as_deref().is_some_and(is_nodes_inserted);
        let current = state
            .node_state
            .get(&job.node_public_key)
            .cloned()
            .unwrap_or_default();
        state.node_state.insert(
            job.node_public_key.clone(),
            if accepted {
                NodeState {
                    cooldown_until: None,
                    accepted_timestamp: Some(job.advert_timestamp),
                    accepted_expires_at: Some(now + SEEN_ADVERT_TTL_MS),
                }
            } else {
                NodeState {
                    cooldown_until: None,
                    ..current
                }
            },
        );
    }

    fn finish_dropped(&self, id: u64, reason: &str) {
        let mut state = self.inner.state.lock().unwrap();
        let Some(index) = state
            .jobs
            .iter()
            .position(|row| row.id == id && row.status == JobStatus::Processing)
        else {
            return;
        };
        let node_key = state.jobs[index].job.node_public_key.clone();
        state.jobs.remove(index);
        state.dropped_uploads += 1;
        if let Some(node) = state.node_state.get_mut(&node_key) {
            node.cooldown_until = None;
        }
        tracing::warn!(reason = %format_error(reason), "MeshCore.io upload dropped");
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn relevant_topic(topic: &str) -> bool {
    let parts = topic.split('/').collect::<Vec<_>>();
    parts.len() >= 4 && parts[0] == "meshcore" && matches!(parts[3], "status" | "packets")
}

fn is_public_key(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn sanitize(value: &str, max: usize) -> Option<String> {
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

fn number(object: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<f64> {
    keys.iter().find_map(|key| {
        object.get(*key).and_then(|value| {
            value
                .as_f64()
                .or_else(|| value.as_str()?.trim().parse::<f64>().ok())
        })
    })
}

fn parse_radio_params(object: &serde_json::Map<String, Value>) -> RadioParams {
    let direct = object
        .get("params")
        .and_then(Value::as_object)
        .unwrap_or(object);
    let mut params = object
        .get("radio")
        .and_then(Value::as_str)
        .map(parse_radio_string)
        .unwrap_or_default();
    let fields = RadioParams {
        freq: number(direct, &["freq", "frequency", "radioFreq"]),
        cr: number(direct, &["cr", "codingRate", "radioCr"]),
        sf: number(direct, &["sf", "spreadingFactor", "radioSf"]),
        bw: number(direct, &["bw", "bandwidth", "radioBw"]),
    };
    if fields.freq.is_some() {
        params.freq = fields.freq;
    }
    if fields.cr.is_some() {
        params.cr = fields.cr;
    }
    if fields.sf.is_some() {
        params.sf = fields.sf;
    }
    if fields.bw.is_some() {
        params.bw = fields.bw;
    }
    if params.freq.is_some_and(|freq| freq > 10_000_000.0) {
        params.freq = params.freq.map(|freq| freq / 1_000_000.0);
    } else if params.freq.is_some_and(|freq| freq > 10_000.0) {
        params.freq = params.freq.map(|freq| freq / 1_000.0);
    }
    if params.bw.is_some_and(|bw| bw > 1_000.0) {
        params.bw = params.bw.map(|bw| bw / 1_000.0);
    }
    params
}

fn parse_radio_string(value: &str) -> RadioParams {
    let comma = value.split(',').map(str::trim).collect::<Vec<_>>();
    let numeric = |token: &str| token.trim().parse::<f64>().ok();
    if comma.len() == 4 && comma.iter().all(|part| numeric(part).is_some()) {
        // TypeScript four-field form: freq,bw,sf,cr.
        return RadioParams {
            freq: numeric(comma[0]),
            bw: numeric(comma[1]),
            sf: numeric(comma[2]),
            cr: numeric(comma[3]),
        };
    }
    if comma.len() == 5 && comma.iter().all(|part| numeric(part).is_some()) {
        // Legacy five-field form: <kind>,freq,bw,sf,cr.
        return RadioParams {
            freq: numeric(comma[1]),
            bw: numeric(comma[2]),
            sf: numeric(comma[3]),
            cr: numeric(comma[4]),
        };
    }
    let tokens = value.split_whitespace().collect::<Vec<_>>();
    let preceding_number = |index: usize| {
        index
            .checked_sub(1)
            .and_then(|previous| numeric(tokens[previous]))
    };
    let following_number = |index: usize| tokens.get(index + 1).and_then(|next| numeric(next));
    let mut params = RadioParams::default();
    for (index, token) in tokens.iter().enumerate() {
        let upper = token.trim().to_ascii_uppercase();
        if let Some(raw) = upper.strip_suffix("MHZ") {
            match raw.trim().parse::<f64>() {
                Ok(freq) => params.freq = Some(freq),
                Err(_) if raw.trim().is_empty() => params.freq = preceding_number(index),
                Err(_) => {}
            }
            continue;
        }
        if let Some(raw) = upper.strip_suffix("KHZ") {
            match raw.trim().parse::<f64>() {
                Ok(freq) => params.freq = Some(freq / 1_000.0),
                Err(_) if raw.trim().is_empty() => {
                    params.freq = preceding_number(index).map(|freq| freq / 1_000.0);
                }
                Err(_) => {}
            }
            continue;
        }
        for (prefix, slot) in [
            ("BW", &mut params.bw),
            ("SF", &mut params.sf),
            ("CR", &mut params.cr),
        ] {
            if let Some(raw) = upper.strip_prefix(prefix) {
                match raw.trim().parse::<f64>() {
                    Ok(value) => *slot = Some(value),
                    Err(_) if raw.trim().is_empty() => *slot = following_number(index),
                    Err(_) => {}
                }
                break;
            }
        }
    }
    params
}

struct PacketCandidate {
    raw_packet: Vec<u8>,
    observer_id: String,
}

fn packet_candidate(topic: &str, payload: &[u8]) -> Option<PacketCandidate> {
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

struct ParsedAdvert {
    public_key: String,
    public_key_bytes: [u8; 32],
    timestamp: u32,
    signature: [u8; 64],
    app_data: Vec<u8>,
    advert_type: String,
    name: Option<String>,
    latitude: Option<f64>,
    longitude: Option<f64>,
}

impl ParsedAdvert {
    fn verify(&self) -> Result<(), String> {
        let key =
            VerifyingKey::from_bytes(&self.public_key_bytes).map_err(|error| error.to_string())?;
        let signature = Signature::from_bytes(&self.signature);
        let mut signed = Vec::with_capacity(36 + self.app_data.len());
        signed.extend_from_slice(&self.public_key_bytes);
        signed.extend_from_slice(&self.timestamp.to_le_bytes());
        signed.extend_from_slice(&self.app_data);
        key.verify(&signed, &signature)
            .map_err(|_| "unverified advert".into())
    }
}

fn parse_advert_packet(packet: &[u8]) -> Result<ParsedAdvert, IngressError> {
    if packet.len() < 2 {
        return Err(IngressError::Retry("packet too short".into()));
    }
    let header = packet[0];
    if (header >> 2) & 0x0f != 4 {
        return Err(IngressError::Retry("not an advert".into()));
    }
    let mut offset = 1;
    if matches!(header & 0x03, 0 | 3) {
        offset += 4;
    }
    let path_len = *packet
        .get(offset)
        .ok_or_else(|| IngressError::Retry("missing path length".into()))?;
    offset += 1;
    let path_bytes = (usize::from(path_len >> 6) + 1) * usize::from(path_len & 63);
    offset = offset
        .checked_add(path_bytes)
        .ok_or_else(|| IngressError::Retry("path overflow".into()))?;
    let payload = packet
        .get(offset..)
        .ok_or_else(|| IngressError::Retry("invalid path length".into()))?;
    if payload.len() < 101 {
        return Err(IngressError::Retry("advert too short".into()));
    }
    let public_key_bytes: [u8; 32] = payload[..32].try_into().unwrap();
    let timestamp = u32::from_le_bytes(payload[32..36].try_into().unwrap());
    let signature = payload[36..100].try_into().unwrap();
    let app_data = payload[100..].to_vec();
    let flags = app_data[0];
    let advert_type = match flags & 0x0f {
        2 => "REPEATER",
        3 => "ROOM",
        4 => "SENSOR",
        _ => "UNKNOWN",
    }
    .to_owned();
    let mut cursor = 1;
    let (latitude, longitude) = if flags & 0x10 != 0 {
        let lat = i32::from_le_bytes(
            app_data
                .get(cursor..cursor + 4)
                .ok_or_else(|| IngressError::Retry("missing latitude".into()))?
                .try_into()
                .unwrap(),
        );
        cursor += 4;
        let lon = i32::from_le_bytes(
            app_data
                .get(cursor..cursor + 4)
                .ok_or_else(|| IngressError::Retry("missing longitude".into()))?
                .try_into()
                .unwrap(),
        );
        cursor += 4;
        let coords = (f64::from(lat) / 1_000_000.0, f64::from(lon) / 1_000_000.0);
        if !(-90.0..=90.0).contains(&coords.0) || !(-180.0..=180.0).contains(&coords.1) {
            (None, None)
        } else {
            (Some(coords.0), Some(coords.1))
        }
    } else {
        (None, None)
    };
    if flags & 0x20 != 0 {
        cursor += 2;
    }
    if flags & 0x40 != 0 {
        cursor += 2;
    }
    let name = if flags & 0x80 != 0 {
        app_data
            .get(cursor..)
            .and_then(|bytes| sanitize(&String::from_utf8_lossy(bytes), 200))
    } else {
        None
    };
    Ok(ParsedAdvert {
        public_key: hex::encode(public_key_bytes),
        public_key_bytes,
        timestamp,
        signature,
        app_data,
        advert_type,
        name,
        latitude,
        longitude,
    })
}

fn is_advert_packet(packet: &[u8]) -> bool {
    packet
        .first()
        .is_some_and(|header| (header >> 2) & 0x0f == 4)
}

fn is_nodes_inserted(value: &str) -> bool {
    serde_json::from_str::<Value>(value)
        .ok()
        .and_then(|value| value.get("code")?.as_str().map(str::to_owned))
        .as_deref()
        == Some("NODES_INSERTED")
}

fn node_state_live(state: &NodeState, now: u64) -> bool {
    state.cooldown_until.is_some_and(|value| value > now)
        || state.accepted_expires_at.is_some_and(|value| value > now)
}

fn sweep_state(state: &mut RuntimeState, now: u64) {
    state
        .ingress
        .retain(|row| row.processing || row.expires_at > now);
    state.dedup.retain(|_, expires| *expires > now);
    state.observer_radio.retain(|_, row| row.expires_at > now);
    state.node_state.retain(|_, row| node_state_live(row, now));
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    fn config() -> MeshcoreIoConfig {
        MeshcoreIoConfig {
            enabled: true,
            api_url: "https://example.invalid".into(),
            private_key: Some(hex::encode([7_u8; 32])),
            min_reupload_seconds: 3_600,
            request_timeout_ms: 1_000,
            workers: 1,
            max_queued_uploads: 1,
            attempts: 2,
            retry_delay_ms: 0,
            ingress_dedup_ms: 1_000,
            ..Default::default()
        }
    }

    fn job(suffix: char) -> UploadJob {
        let node_public_key = format!("{}{}", "a".repeat(63), suffix);
        UploadJob {
            request_id: format!("request-{suffix}"),
            retries_allowed: 2,
            advert_key: format!("{node_public_key}:100"),
            advert_timestamp: 100,
            advert_type: "REPEATER".into(),
            node_name: format!("Node {suffix}"),
            node_public_key,
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
            enqueued_at: now_ms(),
        }
    }

    #[test]
    fn signed_request_uses_the_typescript_public_key_field_name() {
        // MeshCore.io's upload API expects the TypeScript SignedRequest
        // schema: {"data": "...", "signature": "...", "publicKey": "..."}.
        // Pin the exact field names for both supported key formats so a
        // serde rename can never silently break the external contract.
        let seed = [9_u8; 32];
        let mut expanded: [u8; 64] = Sha512::digest(seed).into();
        expanded[0] &= 248;
        expanded[31] &= 63;
        expanded[31] |= 64;
        for key in [hex::encode(seed), hex::encode(expanded)] {
            let poster = HttpMeshcorePoster::new(MeshcoreIoConfig {
                private_key: Some(key),
                ..config()
            })
            .unwrap();
            let request = poster.signed_request(&job('1')).unwrap();
            let value = serde_json::to_value(&request).unwrap();
            let object = value.as_object().unwrap();
            assert_eq!(object.len(), 3);
            let mut keys = object.keys().cloned().collect::<Vec<_>>();
            keys.sort();
            assert_eq!(keys, ["data", "publicKey", "signature"]);
            assert!(object.get("data").unwrap().is_string());
            assert!(object.get("signature").unwrap().is_string());
            assert!(object.get("publicKey").unwrap().is_string());
            assert!(object.get("public_key").is_none());
        }
    }

    #[test]
    fn seed_and_expanded_keys_produce_verifiable_signatures() {
        let seed = [9_u8; 32];
        let mut expanded: [u8; 64] = Sha512::digest(seed).into();
        expanded[0] &= 248;
        expanded[31] &= 63;
        expanded[31] |= 64;
        for key in [hex::encode(seed), hex::encode(expanded)] {
            let poster = HttpMeshcorePoster::new(MeshcoreIoConfig {
                private_key: Some(key),
                ..config()
            })
            .unwrap();
            let request = poster.signed_request(&job('1')).unwrap();
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

    struct SequencePoster {
        calls: AtomicUsize,
        retry_first: bool,
    }

    struct BlockingPoster {
        started: tokio::sync::Semaphore,
    }

    #[async_trait]
    impl MeshcorePoster for BlockingPoster {
        async fn post(&self, _job: &UploadJob) -> PosterResult {
            self.started.add_permits(1);
            std::future::pending().await
        }
    }

    #[async_trait]
    impl MeshcorePoster for SequencePoster {
        async fn post(&self, _job: &UploadJob) -> PosterResult {
            let call = self.calls.fetch_add(1, Ordering::AcqRel);
            if self.retry_first && call == 0 {
                PosterResult::Retry("temporary".into())
            } else {
                PosterResult::Handled(Some(r#"{"code":"NODES_INSERTED"}"#.into()))
            }
        }
    }

    #[tokio::test]
    async fn retry_completion_drop_and_queue_counters_match_contract() {
        let poster = Arc::new(SequencePoster {
            calls: AtomicUsize::new(0),
            retry_first: true,
        });
        let runtime = MeshcoreIoRuntime::with_poster(config(), poster.clone(), false);
        runtime.admit_job(job('1'));
        runtime.admit_job(job('2'));
        assert_eq!(runtime.stats().jobs_pending, 1);
        let first = runtime.claim_job().unwrap();
        runtime.process_job(first).await;
        assert_eq!(runtime.stats().jobs_retrying, 1);
        let retry = runtime.claim_job().unwrap();
        assert_eq!(retry.attempt_count, 2);
        runtime.process_job(retry).await;
        assert_eq!(runtime.stats().completed_uploads, 1);
        assert_eq!(runtime.stats().dropped_uploads, 0);
        assert_eq!(poster.calls.load(Ordering::Acquire), 2);

        let dropping = Arc::new(SequencePoster {
            calls: AtomicUsize::new(0),
            retry_first: true,
        });
        let runtime = MeshcoreIoRuntime::with_poster(
            MeshcoreIoConfig {
                attempts: 1,
                ..config()
            },
            dropping,
            false,
        );
        let mut one_attempt = job('3');
        one_attempt.retries_allowed = 1;
        runtime.admit_job(one_attempt);
        let row = runtime.claim_job().unwrap();
        runtime.process_job(row).await;
        assert_eq!(runtime.stats().dropped_uploads, 1);
    }

    #[tokio::test]
    async fn shutdown_cancels_an_in_flight_http_upload_and_joins_workers() {
        let poster = Arc::new(BlockingPoster {
            started: tokio::sync::Semaphore::new(0),
        });
        let runtime = MeshcoreIoRuntime::with_poster(config(), poster.clone(), true);
        runtime.admit_job(job('1'));
        let permit = tokio::time::timeout(Duration::from_secs(1), poster.started.acquire())
            .await
            .expect("worker did not start upload")
            .unwrap();
        permit.forget();
        tokio::time::timeout(Duration::from_secs(1), runtime.stop())
            .await
            .expect("shutdown did not cancel in-flight upload");
    }

    #[tokio::test(start_paused = true)]
    async fn expired_state_is_swept_periodically_outside_the_ingress_loop() {
        let runtime = MeshcoreIoRuntime::with_poster(
            config(),
            Arc::new(SequencePoster {
                calls: AtomicUsize::new(0),
                retry_first: false,
            }),
            true,
        );
        tokio::task::yield_now().await;
        runtime
            .inner
            .state
            .lock()
            .unwrap()
            .dedup
            .insert([42; 32], 0);

        tokio::time::advance(STATE_SWEEP_INTERVAL).await;
        tokio::task::yield_now().await;

        assert!(runtime.inner.state.lock().unwrap().dedup.is_empty());
        runtime.stop().await;
    }

    #[test]
    fn ingress_dedup_and_radio_normalization_are_bounded() {
        let runtime = MeshcoreIoRuntime::with_poster(
            config(),
            Arc::new(SequencePoster {
                calls: AtomicUsize::new(0),
                retry_first: false,
            }),
            false,
        );
        let topic = format!("meshcore/STO/{}/status", "b".repeat(64));
        let payload = br#"{"origin_id":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","freq":869525000,"bw":125000,"sf":11,"cr":5}"#;
        runtime.offer_publish(&topic, payload);
        runtime.offer_publish(&topic, payload);
        assert_eq!(runtime.stats().ingress_pending, 1);
        assert_eq!(runtime.stats().dedup_entries, 1);
    }

    #[test]
    fn radio_string_forms_match_the_typescript_parser() {
        let params = |radio: &str| {
            parse_radio_params(serde_json::json!({"radio": radio}).as_object().unwrap())
        };

        // TypeScript four-field form: freq,bw,sf,cr.
        let four = params("868.0,125,7,5");
        assert_eq!(four.freq, Some(868.0));
        assert_eq!(four.bw, Some(125.0));
        assert_eq!(four.sf, Some(7.0));
        assert_eq!(four.cr, Some(5.0));
        assert!(four.valid());

        // Four-field values in Hz/kHz are unit-normalized like TS.
        let hertz = params("869525000,125000,11,5");
        assert_eq!(hertz.freq, Some(869.525));
        assert_eq!(hertz.bw, Some(125.0));
        assert!(hertz.valid());

        // Legacy five-field form remains accepted.
        let legacy = params("0,869525000,125000,11,5");
        assert_eq!(legacy.freq, Some(869.525));
        assert_eq!(legacy.bw, Some(125.0));
        assert!(legacy.valid());

        // Labeled single-token and paired forms.
        for radio in [
            "869.525MHz BW125 SF11 CR5",
            "868 MHz BW125 SF7 CR5",
            "868 MHz BW 125 SF 7 CR 5",
            "868000 KHz BW125 SF7 CR5",
        ] {
            assert!(params(radio).valid(), "{radio}");
        }
        assert_eq!(params("868000 KHz BW125 SF7 CR5").freq, Some(868.0));

        // Numeric status fields keep feeding the upload path.
        let fields = serde_json::json!({
            "origin_id": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            "freq": 869525000,
            "bw": 125000,
            "sf": 11,
            "cr": 5,
        });
        let fields = parse_radio_params(fields.as_object().unwrap());
        assert_eq!(fields.freq, Some(869.525));
        assert!(fields.valid());

        assert!(!params("not a radio string").valid());
    }

    #[test]
    fn legacy_radio_strings_and_plain_packet_hex_remain_accepted() {
        let comma = serde_json::json!({"radio": "0,869525000,125000,11,5"});
        let params = parse_radio_params(comma.as_object().unwrap());
        assert_eq!(params.freq, Some(869.525));
        assert_eq!(params.bw, Some(125.0));
        assert!(params.valid());

        let labeled = serde_json::json!({"radio": "869.525MHz BW125 SF11 CR5"});
        assert!(parse_radio_params(labeled.as_object().unwrap()).valid());

        let key = "a".repeat(64);
        let topic = format!("meshcore/STO/{key}/packets");
        let candidate = packet_candidate(&topic, b"0200").unwrap();
        assert_eq!(candidate.raw_packet, [2, 0]);
        assert!(!is_advert_packet(&candidate.raw_packet));
    }

    /// Build a verifiable REPEATER advert packet plus its signer public key.
    fn advert_packet(timestamp: u32) -> (Vec<u8>, String) {
        let signing = SigningKey::from_bytes(&[11; 32]);
        let public = signing.verifying_key().to_bytes();
        let app_data = vec![0x02_u8]; // REPEATER, no coordinates, no name
        let mut signed = Vec::with_capacity(36 + app_data.len());
        signed.extend_from_slice(&public);
        signed.extend_from_slice(&timestamp.to_le_bytes());
        signed.extend_from_slice(&app_data);
        let signature = signing.sign(&signed);
        let mut packet = vec![0x10, 0, 0, 0, 0, 0]; // header, hop fields, path len
        packet.extend_from_slice(&public);
        packet.extend_from_slice(&timestamp.to_le_bytes());
        packet.extend_from_slice(&signature.to_bytes());
        packet.extend_from_slice(&app_data);
        (packet, hex::encode(public))
    }

    #[test]
    fn unknown_ingress_subtopic_is_a_terminal_error() {
        let runtime = MeshcoreIoRuntime::with_poster(
            config(),
            Arc::new(SequencePoster {
                calls: AtomicUsize::new(0),
                retry_first: false,
            }),
            false,
        );
        let topic = format!("meshcore/STO/{}/other", "a".repeat(64));
        assert!(matches!(
            runtime.process_ingress(&topic, b"{}", now_ms()),
            Err(IngressError::Terminal(_))
        ));
    }

    #[tokio::test(start_paused = true)]
    async fn poison_ingress_waits_for_the_backoff_between_attempts() {
        let runtime = MeshcoreIoRuntime::with_poster(
            config(),
            Arc::new(SequencePoster {
                calls: AtomicUsize::new(0),
                retry_first: false,
            }),
            true,
        );
        let topic = format!("meshcore/STO/{}/packets", "a".repeat(64));
        runtime.offer_publish(&topic, b"xyz");
        // The first attempt fails immediately, then ~1 s backoff per retry:
        // after 2 s the poison row must still be pending (without the
        // backoff it would be exhausted after five 250 ms polls).
        tokio::time::sleep(Duration::from_secs(2)).await;
        assert_eq!(runtime.stats().ingress_pending, 1);
        // After five attempts the poison row is dropped.
        tokio::time::sleep(Duration::from_secs(4)).await;
        assert_eq!(runtime.stats().ingress_pending, 0);
        runtime.stop().await;
    }

    #[tokio::test(start_paused = true)]
    async fn status_arriving_after_the_packet_unblocks_it_on_retry() {
        let runtime = MeshcoreIoRuntime::with_poster(
            config(),
            Arc::new(SequencePoster {
                calls: AtomicUsize::new(0),
                retry_first: false,
            }),
            true,
        );
        let (packet, key) = advert_packet(100);
        let packets_topic = format!("meshcore/STO/{key}/packets");
        let packet_payload = format!(
            r#"{{"origin_id":"{key}","raw":"{}"}}"#,
            hex::encode(&packet)
        );
        runtime.offer_publish(&packets_topic, packet_payload.as_bytes());
        // The status (radio parameters) arrives right after the packet.
        let status_topic = format!("meshcore/STO/{key}/status");
        let status_payload =
            format!(r#"{{"origin_id":"{key}","freq":869525000,"bw":125000,"sf":11,"cr":5}}"#);
        runtime.offer_publish(&status_topic, status_payload.as_bytes());

        // Before the ~1 s backoff elapses the packet must not have been
        // uploaded: the first attempt failed for missing radio state.
        tokio::time::sleep(Duration::from_millis(500)).await;
        assert_eq!(runtime.stats().completed_uploads, 0);

        // After the backoff the retry sees the freshly remembered radio
        // parameters and completes the upload.
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        while runtime.stats().completed_uploads == 0 && tokio::time::Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert_eq!(runtime.stats().completed_uploads, 1);
        runtime.stop().await;
    }
}
