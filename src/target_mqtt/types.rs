use async_trait::async_trait;
use bytes::Bytes;

#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum TargetError {
    #[error("invalid target configuration: {0}")]
    Configuration(String),
    #[error("target broker not ready")]
    NotReady,
    #[error("target publish timed out")]
    Timeout,
    #[error("target publish failed: {0}")]
    Publish(String),
    #[error("target event loop stopped before publish callback")]
    CallbackStopped,
    #[error("target bridge stopping")]
    Stopping,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TargetStatus {
    pub enabled: bool,
    pub connected: bool,
    pub target_url: Option<String>,
    pub target_host: Option<String>,
    pub client_id: Option<String>,
    pub dropped_messages: u64,
    pub successful_messages: u64,
}

#[async_trait]
pub trait TargetSink: Send + Sync {
    fn connected(&self) -> bool;
    async fn publish(&self, topic: &str, payload: Bytes, retain: bool) -> Result<(), TargetError>;
    async fn stop(&self);
}
