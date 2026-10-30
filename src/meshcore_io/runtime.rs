use super::advert::{is_advert_packet, parse_verified_advert};
use super::ingress::{
    IngressEntry, IngressError, ObserverState, is_public_key, packet_candidate, relevant_topic,
    sanitize,
};
use super::poster::{HttpMeshcorePoster, format_error};
use super::queue::{JobAdmission, JobRow, JobStatus, NodeState, QueueStats, node_state_live};
use super::radio::parse_radio_params;
use super::types::{MeshcoreIoError, MeshcorePoster, PosterResult, UploadJob};
use crate::config::MeshcoreIoConfig;
use indexmap::IndexMap;
use rand::RngExt;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::Notify;
use tokio::task::JoinHandle;

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
    capacity_rejected_uploads: u64,
}
impl MeshcoreIoRuntime {
    pub fn start(config: MeshcoreIoConfig) -> Result<Option<Self>, MeshcoreIoError> {
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
        let max_ingress = 10_000.max(self.inner.config.max_queued_uploads.saturating_mul(20));
        if state.ingress.len() >= max_ingress {
            tracing::warn!(topic, "MeshCore.io ingress full; message dropped");
            return;
        }
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
            capacity_rejected_uploads: state.capacity_rejected_uploads,
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
                    let wait_started = std::time::Instant::now();
                    let mut state = self.inner.state.lock().unwrap();
                    let lock_wait = wait_started.elapsed();
                    let sweep_started = std::time::Instant::now();
                    let before = state.ingress.len()
                        + state.dedup.len()
                        + state.observer_radio.len()
                        + state.node_state.len();
                    sweep_state(&mut state, now_ms());
                    let after = state.ingress.len()
                        + state.dedup.len()
                        + state.observer_radio.len()
                        + state.node_state.len();
                    drop(state);
                    tracing::debug!(
                        lock_wait_us = lock_wait.as_micros() as u64,
                        lock_held_us = sweep_started.elapsed().as_micros() as u64,
                        removed = before.saturating_sub(after),
                        remaining = after,
                        "MeshCore.io state sweep completed"
                    );
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
            .ok_or_else(|| IngressError::Terminal("unparseable packet ingress".into()))?;
        if !is_advert_packet(&candidate.raw_packet) {
            return Ok(());
        }
        let advert =
            parse_verified_advert(&candidate.raw_packet).map_err(IngressError::Terminal)?;
        if !matches!(advert.advert_type.as_str(), "REPEATER" | "ROOM" | "SENSOR") {
            return Ok(());
        }
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
        match self.admit_job(job) {
            JobAdmission::CapacityRejected => {
                Err(IngressError::Retry("upload queue at capacity".into()))
            }
            JobAdmission::Enqueued | JobAdmission::Duplicate | JobAdmission::Cooldown => Ok(()),
        }
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

    #[must_use]
    pub fn admit_job(&self, job: UploadJob) -> JobAdmission {
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
            return JobAdmission::Duplicate;
        }
        if node.cooldown_until.is_some_and(|until| until > now) {
            return JobAdmission::Cooldown;
        }
        if state
            .jobs
            .iter()
            .any(|row| row.job.node_public_key == job.node_public_key)
        {
            return JobAdmission::Duplicate;
        }
        if state.jobs.len() >= self.inner.config.max_queued_uploads {
            state.capacity_rejected_uploads += 1;
            return JobAdmission::CapacityRejected;
        }
        let node_public_key = job.node_public_key.clone();
        state.next_job_id += 1;
        let id = state.next_job_id;
        state.jobs.push(JobRow {
            id,
            job,
            status: JobStatus::Pending,
            next_attempt_at: now,
            attempt_count: 0,
        });
        state.node_state.insert(
            node_public_key,
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
        JobAdmission::Enqueued
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
            PosterResult::Accepted => self.finish_completed(row.id, &row.job, true),
            PosterResult::PermanentlyRejected(_reason) => {
                self.finish_completed(row.id, &row.job, false)
            }
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

    fn finish_completed(&self, id: u64, job: &UploadJob, accepted: bool) {
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
    use crate::meshcore_io::RadioParams;
    use crate::meshcore_io::advert::signed_test_packet;
    use async_trait::async_trait;
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
                PosterResult::Accepted
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
        assert_eq!(runtime.admit_job(job('1')), JobAdmission::Enqueued);
        assert_eq!(runtime.admit_job(job('2')), JobAdmission::CapacityRejected);
        assert_eq!(runtime.stats().jobs_pending, 1);
        assert_eq!(runtime.stats().capacity_rejected_uploads, 1);
        let first = runtime.claim_job().unwrap();
        runtime.process_job(first).await;
        assert_eq!(runtime.stats().jobs_retrying, 1);
        let retry = runtime.claim_job().unwrap();
        assert_eq!(retry.attempt_count, 2);
        runtime.process_job(retry).await;
        assert_eq!(runtime.stats().completed_uploads, 1);
        assert_eq!(runtime.stats().dropped_uploads, 0);
        assert_eq!(poster.calls.load(Ordering::Acquire), 2);
        assert_eq!(runtime.admit_job(job('2')), JobAdmission::Enqueued);
        assert_eq!(runtime.stats().jobs_pending, 1);

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
        assert_eq!(runtime.admit_job(one_attempt), JobAdmission::Enqueued);
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
        assert_eq!(runtime.admit_job(job('1')), JobAdmission::Enqueued);
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
    fn ingress_rejected_for_capacity_is_not_recorded_as_a_duplicate() {
        let runtime = MeshcoreIoRuntime::with_poster(
            config(),
            Arc::new(SequencePoster {
                calls: AtomicUsize::new(0),
                retry_first: false,
            }),
            false,
        );
        let topic = format!("meshcore/STO/{}/status", "b".repeat(64));
        let max_ingress = 10_000.max(runtime.inner.config.max_queued_uploads * 20);
        for index in 0..max_ingress {
            runtime.offer_publish(&topic, index.to_string().as_bytes());
        }
        let payload = b"capacity-retry";
        runtime.offer_publish(&topic, payload);
        assert_eq!(runtime.stats().ingress_pending, max_ingress);

        runtime.inner.state.lock().unwrap().ingress.pop_front();
        runtime.offer_publish(&topic, payload);
        assert_eq!(runtime.stats().ingress_pending, max_ingress);
        let digest: [u8; 32] = Sha256::new()
            .chain_update(topic.as_bytes())
            .chain_update([0])
            .chain_update(payload)
            .finalize()
            .into();
        assert!(
            runtime
                .inner
                .state
                .lock()
                .unwrap()
                .dedup
                .contains_key(&digest)
        );
    }

    #[test]
    fn concurrent_ingress_and_cleanup_preserve_every_accepted_entry() {
        let runtime = MeshcoreIoRuntime::with_poster(
            config(),
            Arc::new(SequencePoster {
                calls: AtomicUsize::new(0),
                retry_first: false,
            }),
            false,
        );
        std::thread::scope(|scope| {
            for worker in 0..4 {
                let runtime = runtime.clone();
                scope.spawn(move || {
                    let topic = format!("meshcore/STO/{}/status", "b".repeat(64));
                    for index in 0..1_000 {
                        runtime.offer_publish(
                            &topic,
                            format!("worker-{worker}-message-{index}").as_bytes(),
                        );
                    }
                });
            }
            let runtime = runtime.clone();
            scope.spawn(move || {
                for _ in 0..20 {
                    sweep_state(&mut runtime.inner.state.lock().unwrap(), now_ms());
                    std::thread::yield_now();
                }
            });
        });
        assert_eq!(runtime.stats().ingress_pending, 4_000);
    }

    /// Build a verifiable REPEATER advert packet plus its signer public key.

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

    #[tokio::test]
    async fn uppercase_hex_advert_reaches_the_upload_poster() {
        let poster = Arc::new(SequencePoster {
            calls: AtomicUsize::new(0),
            retry_first: false,
        });
        let runtime = MeshcoreIoRuntime::with_poster(config(), poster.clone(), false);
        let (packet, key) = signed_test_packet(100);
        let status_topic = format!("meshcore/STO/{key}/status");
        let status =
            format!(r#"{{"origin_id":"{key}","freq":869525000,"bw":125000,"sf":11,"cr":5}}"#);
        runtime
            .process_ingress(&status_topic, status.as_bytes(), now_ms())
            .unwrap();

        let packet_topic = format!("meshcore/STO/{key}/packets");
        let payload = format!(
            r#"{{"origin_id":"{key}","raw":"0X{}"}}"#,
            hex::encode(&packet)
        );
        runtime
            .process_ingress(&packet_topic, payload.as_bytes(), now_ms())
            .unwrap();
        let job = runtime
            .claim_job()
            .expect("uppercase ADVERT was not queued");
        assert_eq!(job.job.raw_packet_hex, hex::encode(packet));
        runtime.process_job(job).await;
        assert_eq!(poster.calls.load(Ordering::Acquire), 1);
        assert_eq!(runtime.stats().completed_uploads, 1);
    }

    #[tokio::test(start_paused = true)]
    async fn malformed_ingress_is_dropped_without_retry() {
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
        tokio::time::advance(Duration::from_millis(1)).await;
        tokio::task::yield_now().await;
        assert_eq!(runtime.stats().ingress_pending, 0);
        runtime.stop().await;
    }

    #[test]
    fn invalid_advert_signature_is_terminal_but_missing_radio_state_retries() {
        let runtime = MeshcoreIoRuntime::with_poster(
            config(),
            Arc::new(SequencePoster {
                calls: AtomicUsize::new(0),
                retry_first: false,
            }),
            false,
        );
        let (mut packet, key) = signed_test_packet(100);
        packet[50] ^= 1;
        let packet_topic = format!("meshcore/STO/{key}/packets");
        let payload = format!(r#"{{"origin_id":"{key}","raw":"{}"}}"#, hex::encode(packet));
        assert!(matches!(
            runtime.process_ingress(&packet_topic, payload.as_bytes(), now_ms()),
            Err(IngressError::Terminal(_))
        ));

        let (packet, key) = signed_test_packet(101);
        let packet_topic = format!("meshcore/STO/{key}/packets");
        let payload = format!(r#"{{"origin_id":"{key}","raw":"{}"}}"#, hex::encode(packet));
        assert!(matches!(
            runtime.process_ingress(&packet_topic, payload.as_bytes(), now_ms()),
            Err(IngressError::Retry(_))
        ));
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
        let (packet, key) = signed_test_packet(100);
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
