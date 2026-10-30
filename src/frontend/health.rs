use crate::config::HealthcheckConfig;
use serde_json::Value;
use std::io;
use std::time::Duration;

#[derive(Debug, thiserror::Error)]
pub enum HealthcheckError {
    #[error("could not build healthcheck HTTP client: {0}")]
    Client(#[source] reqwest::Error),
    #[error("Healthcheck: GET {url} failed: {source}")]
    Request {
        url: String,
        #[source]
        source: reqwest::Error,
    },
    #[error("Healthcheck: GET {url} returned HTTP {status}")]
    Status { url: String, status: u16 },
    #[error("Healthcheck: invalid JSON: {0}")]
    InvalidJson(#[source] reqwest::Error),
    #[error("Healthcheck: unexpected /status body")]
    UnexpectedBody,
}

pub async fn run_healthcheck(config: &HealthcheckConfig) -> Result<(), HealthcheckError> {
    let response = reqwest::Client::builder()
        .timeout(Duration::from_millis(config.timeout_ms))
        .build()
        .map_err(HealthcheckError::Client)?
        .get(&config.url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|source| HealthcheckError::Request {
            url: config.url.clone(),
            source,
        })?;
    if response.status() != reqwest::StatusCode::OK {
        return Err(HealthcheckError::Status {
            url: config.url.clone(),
            status: response.status().as_u16(),
        });
    }
    let body: Value = response
        .json()
        .await
        .map_err(HealthcheckError::InvalidJson)?;
    if body.get("status") != Some(&Value::String("ok".into()))
        || body.get("storage") != Some(&Value::String("stateless".into()))
    {
        return Err(HealthcheckError::UnexpectedBody);
    }
    Ok(())
}

pub async fn shutdown_signal() -> io::Result<()> {
    #[cfg(unix)]
    {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
        tokio::select! {
            result = tokio::signal::ctrl_c() => result,
            _ = terminate.recv() => Ok(()),
        }
    }
    #[cfg(not(unix))]
    tokio::signal::ctrl_c().await
}
