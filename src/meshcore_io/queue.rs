use super::types::UploadJob;

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
    pub capacity_rejected_uploads: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum JobAdmission {
    Enqueued,
    Duplicate,
    Cooldown,
    CapacityRejected,
}

#[derive(Clone, Copy, Eq, PartialEq)]
pub(super) enum JobStatus {
    Pending,
    Processing,
    Retry,
}

#[derive(Clone)]
pub(super) struct JobRow {
    pub(super) id: u64,
    pub(super) job: UploadJob,
    pub(super) status: JobStatus,
    pub(super) next_attempt_at: u64,
    pub(super) attempt_count: u32,
}

#[derive(Clone, Default)]
pub(super) struct NodeState {
    pub(super) cooldown_until: Option<u64>,
    pub(super) accepted_timestamp: Option<u32>,
    pub(super) accepted_expires_at: Option<u64>,
}

pub(super) fn node_state_live(state: &NodeState, now: u64) -> bool {
    state.cooldown_until.is_some_and(|value| value > now)
        || state.accepted_expires_at.is_some_and(|value| value > now)
}
