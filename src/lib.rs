pub mod config;
pub mod frontend;
pub mod meshcore_io;
pub mod mqtt;
pub mod target_mqtt;

// Compatibility paths for existing internal and integration-test callers.
pub use frontend as production;
pub use mqtt::auth;
pub use mqtt::broker::heartbeat;
pub use mqtt::broker::hooks as rmqtt_handler;
pub use mqtt::broker::retained;
pub use mqtt::broker::router as routing;
pub use mqtt::broker::status_guard;
pub use mqtt::errors as error;
pub use mqtt::policy as acl;
pub use target_mqtt as target_bridge;
