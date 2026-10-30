use crate::meshcore_io::{MeshcoreIoRuntime, QueueStats};
use crate::rmqtt_handler::MeshcoreHandler;
use crate::target_bridge::TargetBridge;
use serde_json::{Value, json};
use std::time::Instant;

#[derive(Clone)]
pub struct StatusState {
    started_at: Instant,
    instance_id: String,
    handler: MeshcoreHandler,
    target: Option<TargetBridge>,
    meshcore_io: Option<MeshcoreIoRuntime>,
    meshcore_io_enabled: bool,
}

impl StatusState {
    pub fn new(
        instance_id: String,
        handler: MeshcoreHandler,
        target: Option<TargetBridge>,
        meshcore_io: Option<MeshcoreIoRuntime>,
        meshcore_io_enabled: bool,
    ) -> Self {
        Self {
            started_at: Instant::now(),
            instance_id,
            handler,
            target,
            meshcore_io,
            meshcore_io_enabled,
        }
    }

    pub fn body(&self) -> Value {
        let target = self.target.as_ref().map_or_else(
            || json!({ "enabled": false }),
            |target| {
                let status = target.status();
                json!({
                    "enabled": status.enabled,
                    "connected": status.connected,
                    "droppedMessages": status.dropped_messages,
                    "successfulMessages": status.successful_messages,
                })
            },
        );
        let stats = self
            .meshcore_io
            .as_ref()
            .map(MeshcoreIoRuntime::stats)
            .unwrap_or_default();
        json!({
            "status": "ok",
            "storage": "stateless",
            "instanceId": self.instance_id,
            "uptimeMs": self.started_at.elapsed().as_millis() as u64,
            "observers": self.handler.observer_count(),
            "target": target,
            "meshcoreIo": meshcore_stats(self.meshcore_io_enabled, stats),
        })
    }
}

fn meshcore_stats(enabled: bool, stats: QueueStats) -> Value {
    json!({
        "enabled": enabled,
        "ingressPending": stats.ingress_pending,
        "jobsPending": stats.jobs_pending,
        "jobsProcessing": stats.jobs_processing,
        "jobsRetrying": stats.jobs_retrying,
        "dedupEntries": stats.dedup_entries,
        "observerEntries": stats.observer_entries,
        "nodeEntries": stats.node_entries,
        "completedUploads": stats.completed_uploads,
        "droppedUploads": stats.dropped_uploads,
        "capacityRejectedUploads": stats.capacity_rejected_uploads,
    })
}
