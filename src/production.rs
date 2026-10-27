use crate::config::HealthcheckConfig;
use crate::meshcore_io::{MeshcoreIoRuntime, QueueStats};
use crate::rmqtt_handler::MeshcoreHandler;
use crate::target_bridge::TargetBridge;
use serde_json::{Value, json};
use std::io;
use std::net::SocketAddr;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

const MAX_HTTP_HEADER_BYTES: usize = 16 * 1_024;
const HTTP_HEADER_TIMEOUT: Duration = Duration::from_secs(10);

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
    })
}

pub async fn handle_frontend_connection(
    mut client: TcpStream,
    internal_mqtt: SocketAddr,
    status: StatusState,
) -> io::Result<()> {
    let header = read_header(&mut client).await?;
    let request = std::str::from_utf8(&header).unwrap_or_default();
    let request_line = request.lines().next().unwrap_or_default();
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let path = parts.next().unwrap_or_default();

    if path == "/status" {
        if method != "GET" {
            return write_response(
                &mut client,
                "405 Method Not Allowed",
                b"",
                &[("Allow", "GET")],
            )
            .await;
        }
        let body = serde_json::to_vec(&status.body()).map_err(io::Error::other)?;
        return write_response(
            &mut client,
            "200 OK",
            &body,
            &[
                ("Content-Type", "application/json; charset=utf-8"),
                ("Cache-Control", "no-store"),
            ],
        )
        .await;
    }

    if method == "GET" && is_websocket_upgrade(request) {
        let mut upstream = TcpStream::connect(internal_mqtt).await?;
        upstream.write_all(&header).await?;
        tokio::io::copy_bidirectional(&mut client, &mut upstream).await?;
        return Ok(());
    }

    write_response(&mut client, "404 Not Found", b"", &[]).await
}

async fn read_header(stream: &mut TcpStream) -> io::Result<Vec<u8>> {
    tokio::time::timeout(HTTP_HEADER_TIMEOUT, async {
        let mut header = Vec::with_capacity(1_024);
        loop {
            if header.len() >= MAX_HTTP_HEADER_BYTES {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "HTTP request header exceeds 16 KiB",
                ));
            }
            let mut chunk = [0_u8; 1_024];
            let read = stream.read(&mut chunk).await?;
            if read == 0 {
                return Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "connection closed before HTTP headers",
                ));
            }
            header.extend_from_slice(&chunk[..read]);
            if header.len() > MAX_HTTP_HEADER_BYTES {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "HTTP request header exceeds 16 KiB",
                ));
            }
            if header.windows(4).any(|window| window == b"\r\n\r\n") {
                return Ok(header);
            }
        }
    })
    .await
    .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "HTTP header timed out"))?
}

fn is_websocket_upgrade(request: &str) -> bool {
    request.lines().skip(1).any(|line| {
        line.split_once(':').is_some_and(|(name, value)| {
            name.eq_ignore_ascii_case("upgrade") && value.trim().eq_ignore_ascii_case("websocket")
        })
    })
}

async fn write_response(
    stream: &mut TcpStream,
    status: &str,
    body: &[u8],
    headers: &[(&str, &str)],
) -> io::Result<()> {
    let mut response = format!(
        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n",
        body.len()
    );
    for (name, value) in headers {
        response.push_str(name);
        response.push_str(": ");
        response.push_str(value);
        response.push_str("\r\n");
    }
    response.push_str("\r\n");
    stream.write_all(response.as_bytes()).await?;
    stream.write_all(body).await?;
    stream.shutdown().await
}

pub async fn run_healthcheck(config: &HealthcheckConfig) -> Result<(), String> {
    let response = reqwest::Client::builder()
        .timeout(Duration::from_millis(config.timeout_ms))
        .build()
        .map_err(|error| error.to_string())?
        .get(&config.url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|error| format!("Healthcheck: GET {} failed: {error}", config.url))?;
    if response.status() != reqwest::StatusCode::OK {
        return Err(format!(
            "Healthcheck: GET {} returned HTTP {}",
            config.url,
            response.status().as_u16()
        ));
    }
    let body: Value = response
        .json()
        .await
        .map_err(|error| format!("Healthcheck: invalid JSON: {error}"))?;
    if body.get("status") != Some(&Value::String("ok".into()))
        || body.get("storage") != Some(&Value::String("stateless".into()))
    {
        return Err("Healthcheck: unexpected /status body".into());
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Config, HealthcheckConfig};
    use rmqtt::context::ServerContext;
    use std::collections::{HashMap, HashSet};
    use std::net::{IpAddr, Ipv4Addr};
    use std::sync::Arc;
    use tokio::net::TcpListener;

    async fn status_state() -> StatusState {
        let config = Arc::new(Config {
            listener: SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0),
            ws_max_payload_bytes: 65_536,
            json_publish_max_bytes: 8_192,
            broker_name: "test".into(),
            expected_audience: "test".into(),
            token_max_age_seconds: 0,
            subscribers: HashMap::new(),
            allowed_iata: HashSet::new(),
            secondary_iata: HashMap::new(),
            allow_test_ingress: false,
            target_mqtt: Default::default(),
            meshcore_io: Default::default(),
            healthcheck: HealthcheckConfig {
                url: "http://127.0.0.1:8883/status".into(),
                timeout_ms: 8_000,
            },
        });
        let scx = ServerContext::new().build().await;
        let handler = MeshcoreHandler::new(config, scx);
        StatusState::new("test-instance".into(), handler, None, None, false)
    }

    #[test]
    fn websocket_detection_is_case_insensitive_but_requires_upgrade() {
        assert!(is_websocket_upgrade(
            "GET / HTTP/1.1\r\nUpgrade: WebSocket\r\n\r\n"
        ));
        assert!(!is_websocket_upgrade("GET / HTTP/1.1\r\n\r\n"));
    }

    #[tokio::test]
    async fn status_endpoint_uses_the_documented_stateless_contract() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let address = listener.local_addr().unwrap();
        let status = status_state().await;
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            handle_frontend_connection(stream, "127.0.0.1:1".parse().unwrap(), status)
                .await
                .unwrap();
        });
        let mut client = TcpStream::connect(address).await.unwrap();
        client
            .write_all(b"GET /status HTTP/1.1\r\nHost: localhost\r\n\r\n")
            .await
            .unwrap();
        let mut response = Vec::new();
        client.read_to_end(&mut response).await.unwrap();
        server.await.unwrap();
        let response = String::from_utf8(response).unwrap();
        assert!(response.starts_with("HTTP/1.1 200 OK\r\n"));
        let body: Value = serde_json::from_str(response.split("\r\n\r\n").nth(1).unwrap()).unwrap();
        assert_eq!(body["status"], "ok");
        assert_eq!(body["storage"], "stateless");
        assert_eq!(body["instanceId"], "test-instance");
        assert_eq!(body["observers"], 0);
        assert_eq!(body["target"]["enabled"], false);
        assert_eq!(body["meshcoreIo"]["completedUploads"], 0);
    }

    #[tokio::test]
    async fn websocket_requests_are_forwarded_to_the_internal_rmqtt_listener() {
        let internal = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let internal_address = internal.local_addr().unwrap();
        let upstream = tokio::spawn(async move {
            let (mut stream, _) = internal.accept().await.unwrap();
            let header = read_header(&mut stream).await.unwrap();
            assert!(String::from_utf8_lossy(&header).contains("Sec-WebSocket-Protocol: mqtt"));
            stream
                .write_all(b"HTTP/1.1 101 Switching Protocols\r\nContent-Length: 0\r\n\r\n")
                .await
                .unwrap();
        });
        let frontend = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let frontend_address = frontend.local_addr().unwrap();
        let status = status_state().await;
        let proxy = tokio::spawn(async move {
            let (stream, _) = frontend.accept().await.unwrap();
            handle_frontend_connection(stream, internal_address, status)
                .await
                .unwrap();
        });
        let mut client = TcpStream::connect(frontend_address).await.unwrap();
        client
            .write_all(
                b"GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nSec-WebSocket-Protocol: mqtt\r\n\r\n",
            )
            .await
            .unwrap();
        let mut response = [0_u8; 256];
        let read = client.read(&mut response).await.unwrap();
        assert!(String::from_utf8_lossy(&response[..read]).starts_with("HTTP/1.1 101"));
        client.shutdown().await.unwrap();
        upstream.await.unwrap();
        proxy.await.unwrap();
    }
}
