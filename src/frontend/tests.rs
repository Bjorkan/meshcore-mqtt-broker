use super::*;
use crate::auth::ObserverOwnership;
use crate::config::{Config, HealthcheckConfig};
use crate::rmqtt_handler::MeshcoreHandler;
use rmqtt::context::ServerContext;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::io;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

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
    let request = "GET / HTTP/1.1\r\nX-Forwarded-For: 192.0.2.9, 198.51.100.42, 10.0.0.8\r\n\r\n";
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
