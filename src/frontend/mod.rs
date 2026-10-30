mod health;
mod proxy;
mod server;
mod status;
mod websocket;

pub use health::{HealthcheckError, run_healthcheck, shutdown_signal};
pub use server::handle_frontend_connection;
pub use status::StatusState;

#[cfg(test)]
use proxy::forwarded_source;
#[cfg(test)]
use websocket::{is_websocket_upgrade, read_header};

#[cfg(test)]
mod tests;
