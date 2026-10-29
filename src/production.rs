use crate::config::{HealthcheckConfig, IpNetwork};
use crate::meshcore_io::{MeshcoreIoRuntime, QueueStats};
use crate::rmqtt_handler::MeshcoreHandler;
use crate::target_bridge::TargetBridge;
use serde_json::{Value, json};
use std::io;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use std::time::{Duration, Instant};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
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
        "capacityRejectedUploads": stats.capacity_rejected_uploads,
    })
}

pub async fn handle_frontend_connection(
    mut client: TcpStream,
    internal_mqtt: SocketAddr,
    status: StatusState,
    ws_max_payload_bytes: usize,
    trusted_proxies: Arc<[IpNetwork]>,
) -> io::Result<()> {
    let transport_peer = client.peer_addr()?;
    let external_local = client.local_addr()?;
    let (header, client_trailing) = read_header(&mut client).await?;
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
        let source = forwarded_source(request, transport_peer, &trusted_proxies);
        let mut upstream = TcpStream::connect(internal_mqtt).await?;
        upstream
            .write_all(proxy_protocol_line(source, external_local).as_bytes())
            .await?;
        upstream.write_all(&header).await?;
        let (response, upstream_trailing) = read_header(&mut upstream).await?;
        client.write_all(&response).await?;
        client.write_all(&upstream_trailing).await?;
        return proxy_websocket(client, upstream, client_trailing, ws_max_payload_bytes).await;
    }

    write_response(&mut client, "404 Not Found", b"", &[]).await
}

fn forwarded_source(
    request: &str,
    transport_peer: SocketAddr,
    trusted_proxies: &[IpNetwork],
) -> SocketAddr {
    if !is_trusted_proxy(transport_peer.ip(), trusted_proxies) {
        return transport_peer;
    }

    let forwarded = request
        .lines()
        .skip(1)
        .filter_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.trim()
                .eq_ignore_ascii_case("x-forwarded-for")
                .then_some(value)
        })
        .flat_map(|value| value.split(','))
        .map(str::trim)
        .map(str::parse::<IpAddr>)
        .collect::<Result<Vec<_>, _>>();
    let Ok(forwarded) = forwarded else {
        return transport_peer;
    };

    let mut source = transport_peer.ip();
    for candidate in forwarded.into_iter().rev() {
        if !is_trusted_proxy(source, trusted_proxies) {
            break;
        }
        source = candidate;
    }
    SocketAddr::new(source, transport_peer.port())
}

fn is_trusted_proxy(address: IpAddr, trusted_proxies: &[IpNetwork]) -> bool {
    trusted_proxies
        .iter()
        .any(|network| network.contains(address))
}

fn proxy_protocol_line(source: SocketAddr, destination: SocketAddr) -> String {
    let destination = match (source, destination) {
        (SocketAddr::V4(_), SocketAddr::V4(destination)) => SocketAddr::V4(destination),
        (SocketAddr::V6(_), SocketAddr::V6(destination)) => SocketAddr::V6(destination),
        (SocketAddr::V4(_), _) => {
            SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), destination.port())
        }
        (SocketAddr::V6(_), _) => {
            SocketAddr::new(IpAddr::V6(Ipv6Addr::UNSPECIFIED), destination.port())
        }
    };
    let family = if source.is_ipv4() { "TCP4" } else { "TCP6" };
    format!(
        "PROXY {family} {} {} {} {}\r\n",
        source.ip(),
        destination.ip(),
        source.port(),
        destination.port()
    )
}

async fn read_header(stream: &mut TcpStream) -> io::Result<(Vec<u8>, Vec<u8>)> {
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
            if let Some(index) = header.windows(4).position(|window| window == b"\r\n\r\n") {
                let trailing = header.split_off(index + 4);
                return Ok((header, trailing));
            }
        }
    })
    .await
    .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "HTTP header timed out"))?
}

async fn proxy_websocket(
    mut client: TcpStream,
    mut upstream: TcpStream,
    client_trailing: Vec<u8>,
    max_message_size: usize,
) -> io::Result<()> {
    let (mut client_read, mut client_write) = client.split();
    let (mut upstream_read, mut upstream_write) = upstream.split();
    let mut client_read = PrefixedReader::new(client_trailing, &mut client_read);
    tokio::select! {
        result = copy_websocket_frames_limited(
            &mut client_read,
            &mut upstream_write,
            max_message_size,
        ) => result.map(|_| ()),
        result = tokio::io::copy(&mut upstream_read, &mut client_write) => result.map(|_| ()),
    }
}

struct PrefixedReader<R> {
    prefix: Vec<u8>,
    offset: usize,
    inner: R,
}

impl<R> PrefixedReader<R> {
    fn new(prefix: Vec<u8>, inner: R) -> Self {
        Self {
            prefix,
            offset: 0,
            inner,
        }
    }
}

impl<R: AsyncRead + Unpin> AsyncRead for PrefixedReader<R> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buffer: &mut tokio::io::ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        if self.offset < self.prefix.len() {
            let take = buffer.remaining().min(self.prefix.len() - self.offset);
            buffer.put_slice(&self.prefix[self.offset..self.offset + take]);
            self.offset += take;
            return Poll::Ready(Ok(()));
        }
        Pin::new(&mut self.inner).poll_read(context, buffer)
    }
}

/// Copies client-to-broker WebSocket frames while enforcing a limit on the
/// complete data message. Control frames do not count, and continuation
/// frames share the size budget of the message they extend.
async fn copy_websocket_frames_limited<R, W>(
    reader: &mut R,
    writer: &mut W,
    max_message_size: usize,
) -> io::Result<u64>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let mut copied = 0_u64;
    let mut fragmented_size = None::<usize>;
    loop {
        let first = match reader.read_u8().await {
            Ok(value) => value,
            Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => return Ok(copied),
            Err(error) => return Err(error),
        };
        let second = reader.read_u8().await?;
        let fin = first & 0x80 != 0;
        let opcode = first & 0x0f;
        let masked = second & 0x80 != 0;
        let marker = second & 0x7f;
        let mut frame_header = vec![first, second];
        let payload_len = match marker {
            126 => {
                let mut bytes = [0_u8; 2];
                reader.read_exact(&mut bytes).await?;
                frame_header.extend_from_slice(&bytes);
                u16::from_be_bytes(bytes) as u64
            }
            127 => {
                let mut bytes = [0_u8; 8];
                reader.read_exact(&mut bytes).await?;
                frame_header.extend_from_slice(&bytes);
                u64::from_be_bytes(bytes)
            }
            value => u64::from(value),
        };
        let payload_len = usize::try_from(payload_len)
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "WebSocket frame too large"))?;

        match opcode {
            0x0 => {
                let Some(size) = fragmented_size else {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "WebSocket continuation without an open message",
                    ));
                };
                let size = size.checked_add(payload_len).ok_or_else(|| {
                    io::Error::new(io::ErrorKind::InvalidData, "WebSocket message too large")
                })?;
                if size > max_message_size {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "WebSocket message exceeds configured payload limit",
                    ));
                }
                fragmented_size = (!fin).then_some(size);
            }
            0x1 | 0x2 => {
                if fragmented_size.is_some() {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "new WebSocket data frame during fragmented message",
                    ));
                }
                if payload_len > max_message_size {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "WebSocket message exceeds configured payload limit",
                    ));
                }
                fragmented_size = (!fin).then_some(payload_len);
            }
            0x8..=0xf if fin && payload_len <= 125 => {}
            _ => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "invalid WebSocket opcode or fragmented control frame",
                ));
            }
        }

        if masked {
            let mut mask = [0_u8; 4];
            reader.read_exact(&mut mask).await?;
            frame_header.extend_from_slice(&mask);
        }
        writer.write_all(&frame_header).await?;
        copied += frame_header.len() as u64;

        let mut remaining = payload_len;
        let mut buffer = [0_u8; 8 * 1_024];
        while remaining > 0 {
            let take = remaining.min(buffer.len());
            reader.read_exact(&mut buffer[..take]).await?;
            writer.write_all(&buffer[..take]).await?;
            copied += take as u64;
            remaining -= take;
        }
        writer.flush().await?;
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::ObserverOwnership;
    use crate::config::{Config, HealthcheckConfig};
    use rmqtt::context::ServerContext;
    use std::collections::{HashMap, HashSet};
    use std::net::{IpAddr, Ipv4Addr};
    use std::sync::Arc;
    use tokio::net::TcpListener;

    async fn status_state() -> StatusState {
        let config = Arc::new(Config {
            listener: SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0),
            trusted_proxies: Vec::new(),
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
        let handler = MeshcoreHandler::new(config, scx, ObserverOwnership::default());
        StatusState::new("test-instance".into(), handler, None, None, false)
    }

    #[test]
    fn websocket_detection_is_case_insensitive_but_requires_upgrade() {
        assert!(is_websocket_upgrade(
            "GET / HTTP/1.1\r\nUpgrade: WebSocket\r\n\r\n"
        ));
        assert!(!is_websocket_upgrade("GET / HTTP/1.1\r\n\r\n"));
    }

    #[test]
    fn forwarded_source_requires_a_trusted_peer_and_walks_the_chain_from_the_right() {
        let peer = "127.0.0.1:4567".parse().unwrap();
        let trusted = [
            "127.0.0.0/8".parse().unwrap(),
            "10.0.0.0/8".parse().unwrap(),
        ];
        let request =
            "GET / HTTP/1.1\r\nX-Forwarded-For: 192.0.2.9, 198.51.100.42, 10.0.0.8\r\n\r\n";
        // A direct client cannot spoof a forwarding header.
        assert_eq!(forwarded_source(request, peer, &[]), peer);
        // Starting at the trusted TCP peer, trusted hops are skipped from the
        // right. The first untrusted address is the effective client; values
        // further left are client-controlled and ignored.
        assert_eq!(
            forwarded_source(request, peer, &trusted),
            "198.51.100.42:4567".parse().unwrap()
        );
        assert_eq!(
            forwarded_source(
                "GET / HTTP/1.1\r\nX-Forwarded-For: junk\r\n\r\n",
                peer,
                &trusted,
            ),
            peer
        );
        assert_eq!(
            forwarded_source(
                "GET / HTTP/1.1\r\nX-Forwarded-For: 203.0.113.7\r\nX-Forwarded-For: junk\r\n\r\n",
                peer,
                &trusted,
            ),
            peer
        );
    }

    #[tokio::test]
    async fn status_endpoint_uses_the_documented_stateless_contract() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let address = listener.local_addr().unwrap();
        let status = status_state().await;
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            handle_frontend_connection(
                stream,
                "127.0.0.1:1".parse().unwrap(),
                status,
                65_536,
                Arc::from([]),
            )
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
        assert_eq!(body["meshcoreIo"]["capacityRejectedUploads"], 0);
    }

    #[tokio::test]
    async fn websocket_requests_are_forwarded_to_the_internal_rmqtt_listener() {
        let internal = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let internal_address = internal.local_addr().unwrap();
        let upstream = tokio::spawn(async move {
            let (mut stream, _) = internal.accept().await.unwrap();
            let proxy = read_proxy_line(&mut stream).await;
            assert!(proxy.starts_with("PROXY TCP4 198.51.100.42 "));
            let (header, trailing) = read_header(&mut stream).await.unwrap();
            assert!(trailing.is_empty());
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
            handle_frontend_connection(
                stream,
                internal_address,
                status,
                65_536,
                Arc::from(["127.0.0.1".parse().unwrap()]),
            )
            .await
            .unwrap();
        });
        let mut client = TcpStream::connect(frontend_address).await.unwrap();
        client
            .write_all(
                b"GET / HTTP/1.1\r\nHost: localhost\r\nX-Forwarded-For: 192.0.2.9, 198.51.100.42\r\nUpgrade: websocket\r\nSec-WebSocket-Protocol: mqtt\r\n\r\n",
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

    async fn read_proxy_line(stream: &mut TcpStream) -> String {
        let mut line = Vec::new();
        loop {
            line.push(stream.read_u8().await.unwrap());
            if line.ends_with(b"\r\n") {
                return String::from_utf8(line).unwrap();
            }
            assert!(line.len() < 108, "oversized PROXY protocol line");
        }
    }

    fn masked_frame(fin: bool, opcode: u8, payload: &[u8]) -> Vec<u8> {
        let mut frame = vec![(if fin { 0x80 } else { 0 }) | opcode];
        match payload.len() {
            0..=125 => frame.push(0x80 | payload.len() as u8),
            126..=65_535 => {
                frame.push(0x80 | 126);
                frame.extend_from_slice(&(payload.len() as u16).to_be_bytes());
            }
            _ => {
                frame.push(0x80 | 127);
                frame.extend_from_slice(&(payload.len() as u64).to_be_bytes());
            }
        }
        let mask = [1_u8, 2, 3, 4];
        frame.extend_from_slice(&mask);
        frame.extend(
            payload
                .iter()
                .enumerate()
                .map(|(index, byte)| byte ^ mask[index % 4]),
        );
        frame
    }

    async fn proxy_frames(frames: Vec<u8>, limit: usize) -> (Vec<u8>, io::Result<()>) {
        let internal = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let internal_address = internal.local_addr().unwrap();
        let upstream = tokio::spawn(async move {
            let (mut stream, _) = internal.accept().await.unwrap();
            let _ = read_proxy_line(&mut stream).await;
            let _ = read_header(&mut stream).await.unwrap();
            stream
                .write_all(b"HTTP/1.1 101 Switching Protocols\r\n\r\n")
                .await
                .unwrap();
            let mut forwarded = Vec::new();
            stream.read_to_end(&mut forwarded).await.unwrap();
            forwarded
        });
        let frontend = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let frontend_address = frontend.local_addr().unwrap();
        let status = status_state().await;
        let proxy = tokio::spawn(async move {
            let (stream, _) = frontend.accept().await.unwrap();
            handle_frontend_connection(stream, internal_address, status, limit, Arc::from([])).await
        });
        let mut client = TcpStream::connect(frontend_address).await.unwrap();
        client
            .write_all(
                b"GET /mqtt HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nSec-WebSocket-Protocol: mqtt\r\n\r\n",
            )
            .await
            .unwrap();
        let (response, trailing) = read_header(&mut client).await.unwrap();
        assert!(trailing.is_empty());
        assert!(String::from_utf8_lossy(&response).starts_with("HTTP/1.1 101"));
        client.write_all(&frames).await.unwrap();
        client.shutdown().await.unwrap();
        let result = proxy.await.unwrap();
        (upstream.await.unwrap(), result)
    }

    #[tokio::test]
    async fn websocket_message_limit_counts_composite_and_fragmented_payloads() {
        const LIMIT: usize = 128;
        // A single WS message containing 64 small MQTT PINGREQ packets is
        // accepted at exactly N bytes.
        let mqtt_packets = [0xc0_u8, 0x00].repeat(LIMIT / 2);
        let exact = masked_frame(true, 0x2, &mqtt_packets);
        let (forwarded, result) = proxy_frames(exact.clone(), LIMIT).await;
        result.unwrap();
        assert_eq!(forwarded, exact);

        // Fragmentation cannot bypass the message budget. The first fragment
        // is forwarded; the continuation that would make N+1 is rejected.
        let first = masked_frame(false, 0x2, &mqtt_packets[..64]);
        let continuation = masked_frame(true, 0x0, &[0_u8; LIMIT - 63]);
        let mut oversized = first.clone();
        oversized.extend_from_slice(&continuation);
        let (forwarded, error) = proxy_frames(oversized, LIMIT).await;
        assert_eq!(forwarded, first);
        assert_eq!(error.unwrap_err().kind(), io::ErrorKind::InvalidData);
    }
}
