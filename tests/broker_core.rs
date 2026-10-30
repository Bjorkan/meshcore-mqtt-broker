use async_trait::async_trait;
use base64::Engine;
use bytes::Bytes;
use ed25519_dalek::{Signer, SigningKey};
use futures_util::{SinkExt, StreamExt};
use meshcore_mqtt_broker::config::{
    Config, MeshcoreIoConfig, Subscriber, SubscriberRole, TargetMqttConfig,
};
use meshcore_mqtt_broker::meshcore_io::{
    MeshcoreIoRuntime, MeshcorePoster, PosterResult, UploadJob,
};
use meshcore_mqtt_broker::mqtt::auth::ObserverOwnership;
use meshcore_mqtt_broker::mqtt::broker::{
    BROKER_HEARTBEAT_INTERVAL, HeartbeatPublisher, MemoryRetainStorage, MeshcoreHandler, RoleRouter,
};
use meshcore_mqtt_broker::target_mqtt::{TargetBridge, TargetError, TargetSink};
use rmqtt::context::ServerContext;
use rmqtt::net::Builder;
use rmqtt::server::MqttServer;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener};
use std::sync::Arc;
use std::sync::Mutex as StdMutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tokio::task::JoinHandle;
use tokio::time::{sleep, timeout};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async};

type Socket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

struct Broker {
    port: u16,
    scx: ServerContext,
    task: JoinHandle<rmqtt::net::Result<()>>,
    heartbeat_task: Option<JoinHandle<()>>,
    _registration: Box<dyn rmqtt::hook::Register>,
}

impl Broker {
    fn spawn_heartbeat(&mut self, interval: Duration) {
        self.heartbeat_task =
            Some(HeartbeatPublisher::with_interval(self.scx.clone(), interval).spawn_task());
    }
}

impl Drop for Broker {
    fn drop(&mut self) {
        self.task.abort();
        if let Some(task) = self.heartbeat_task.take() {
            task.abort();
        }
    }
}

async fn start_broker() -> Broker {
    start_broker_with_heartbeat(Some(BROKER_HEARTBEAT_INTERVAL)).await
}

async fn start_broker_with_heartbeat(heartbeat_interval: Option<Duration>) -> Broker {
    start_broker_with_integrations(heartbeat_interval, None, None).await
}

async fn start_broker_with_integrations(
    heartbeat_interval: Option<Duration>,
    target: Option<TargetBridge>,
    meshcore_io: Option<MeshcoreIoRuntime>,
) -> Broker {
    let port = {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        listener.local_addr().unwrap().port()
    };
    let config = Arc::new(Config {
        listener: SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port),
        trusted_proxies: Vec::new(),
        ws_max_payload_bytes: 65_536,
        json_publish_max_bytes: 8_192,
        broker_name: "integration".into(),
        expected_audience: "integration".into(),
        token_max_age_seconds: 0,
        subscribers: HashMap::from([
            (
                "full".into(),
                Subscriber {
                    password: "secret".into(),
                    role: SubscriberRole::FullAccess,
                    max_connections: 2,
                },
            ),
            (
                "limited".into(),
                Subscriber {
                    password: "secret".into(),
                    role: SubscriberRole::Limited,
                    max_connections: 2,
                },
            ),
            (
                "admin".into(),
                Subscriber {
                    password: "secret".into(),
                    role: SubscriberRole::Admin,
                    max_connections: 2,
                },
            ),
        ]),
        allowed_iata: HashSet::from(["GOT".into(), "MMX".into(), "STO".into()]),
        secondary_iata: HashMap::from([("ARN".into(), "STO".into())]),
        allow_test_ingress: false,
        target_mqtt: Default::default(),
        meshcore_io: Default::default(),
        healthcheck: meshcore_mqtt_broker::config::HealthcheckConfig {
            url: "http://127.0.0.1:8883/status".into(),
            timeout_ms: 8_000,
        },
    });
    let scx = ServerContext::new().build().await;
    let ownership = ObserverOwnership::default();
    *scx.extends.router_mut().await = Box::new(RoleRouter::new(
        scx.clone(),
        config.clone(),
        ownership.clone(),
    ));
    MemoryRetainStorage::new(scx.clone()).install().await;
    let handler = MeshcoreHandler::new(config.clone(), scx.clone(), ownership)
        .with_integrations(target, meshcore_io);
    let registration = handler.register().await;
    let heartbeat_task = heartbeat_interval
        .map(|interval| HeartbeatPublisher::with_interval(scx.clone(), interval).spawn_task());
    let listener = Builder::new()
        .name("integration/ws")
        .laddr(config.listener)
        .allow_anonymous(false)
        .max_packet_size(config.ws_max_payload_bytes)
        .bind()
        .unwrap()
        .ws()
        .unwrap();
    let task = tokio::spawn(
        MqttServer::new(scx.clone())
            .listener(listener)
            .build()
            .run(),
    );
    sleep(Duration::from_millis(30)).await;
    Broker {
        port,
        scx,
        task,
        heartbeat_task,
        _registration: registration,
    }
}

#[derive(Default)]
struct RecordingTarget {
    connected: AtomicBool,
    writes: StdMutex<Vec<(String, Vec<u8>, bool)>>,
}

#[async_trait]
impl TargetSink for RecordingTarget {
    fn connected(&self) -> bool {
        self.connected.load(Ordering::Acquire)
    }

    async fn publish(&self, topic: &str, payload: Bytes, retain: bool) -> Result<(), TargetError> {
        self.writes
            .lock()
            .unwrap()
            .push((topic.into(), payload.to_vec(), retain));
        Ok(())
    }

    async fn stop(&self) {}
}

struct NoopPoster;

#[async_trait]
impl MeshcorePoster for NoopPoster {
    async fn post(&self, _job: &UploadJob) -> PosterResult {
        PosterResult::PermanentlyRejected("noop test poster".into())
    }
}

async fn websocket(port: u16) -> Socket {
    websocket_path(port, "/").await
}

async fn websocket_path(port: u16, path: &str) -> Socket {
    let mut request = format!("ws://127.0.0.1:{port}{path}")
        .into_client_request()
        .unwrap();
    request
        .headers_mut()
        .insert("Sec-WebSocket-Protocol", HeaderValue::from_static("mqtt"));
    let (socket, response) = connect_async(request).await.unwrap();
    assert_eq!(response.status(), 101);
    assert_eq!(response.headers()["Sec-WebSocket-Protocol"], "mqtt");
    socket
}

async fn connect(port: u16, client_id: &str, username: &str, password: &str) -> Socket {
    connect_path(port, "/", client_id, username, password).await
}

async fn connect_path(
    port: u16,
    path: &str,
    client_id: &str,
    username: &str,
    password: &str,
) -> Socket {
    let mut socket = websocket_path(port, path).await;
    socket
        .send(Message::Binary(
            mqtt_connect(client_id, username, password).into(),
        ))
        .await
        .unwrap();
    assert_eq!(read_packet(&mut socket).await, vec![0x20, 0x02, 0x00, 0x00]);
    socket
}

async fn subscribe(socket: &mut Socket, packet_id: u16, topic: &str) -> u8 {
    socket
        .send(Message::Binary(mqtt_subscribe(packet_id, topic).into()))
        .await
        .unwrap();
    let packet = read_packet(socket).await;
    assert_eq!(packet[0], 0x90);
    *packet.last().unwrap()
}

async fn publish(socket: &mut Socket, topic: &str, payload: &[u8]) {
    publish_with_retain(socket, topic, payload, false).await;
}

async fn publish_with_retain(socket: &mut Socket, topic: &str, payload: &[u8], retain: bool) {
    socket
        .send(Message::Binary(mqtt_publish(topic, payload, retain).into()))
        .await
        .unwrap();
}

async fn read_packet(socket: &mut Socket) -> Vec<u8> {
    loop {
        let message = timeout(Duration::from_secs(2), socket.next())
            .await
            .expect("timed out waiting for MQTT packet")
            .expect("WebSocket closed")
            .expect("WebSocket error");
        if let Message::Binary(bytes) = message {
            return bytes.to_vec();
        }
    }
}

async fn assert_no_packet(socket: &mut Socket) {
    assert!(
        timeout(Duration::from_millis(150), socket.next())
            .await
            .is_err()
    );
}

fn decode_publish(packet: &[u8]) -> (String, Vec<u8>) {
    assert_eq!(packet[0] & 0xf0, 0x30);
    let qos = (packet[0] >> 1) & 0x03;
    let (remaining, offset) = decode_remaining(&packet[1..]);
    let body = &packet[1 + offset..1 + offset + remaining];
    let topic_len = u16::from_be_bytes([body[0], body[1]]) as usize;
    let topic = String::from_utf8(body[2..2 + topic_len].to_vec()).unwrap();
    let mut cursor = 2 + topic_len;
    if qos > 0 {
        cursor += 2; // packet identifier
    }
    (topic, body[cursor..].to_vec())
}

async fn read_puback(socket: &mut Socket, packet_id: u16) {
    let packet = read_packet(socket).await;
    assert_eq!(packet[0], 0x40, "expected PUBACK");
    assert_eq!(packet[1], 2, "PUBACK must carry a two-byte packet id");
    assert_eq!(&packet[2..], &packet_id.to_be_bytes());
}

fn mqtt_connect(client_id: &str, username: &str, password: &str) -> Vec<u8> {
    let mut body = vec![0, 4, b'M', b'Q', b'T', b'T', 4, 0xc2, 0, 30];
    put_utf8(&mut body, client_id);
    put_utf8(&mut body, username);
    put_bytes(&mut body, password.as_bytes());
    packet(0x10, body)
}

fn mqtt_connect_with_will(
    client_id: &str,
    username: &str,
    password: &str,
    will_topic: &str,
    will_payload: &[u8],
    retain: bool,
) -> Vec<u8> {
    let mut flags = 0xc6;
    if retain {
        flags |= 0x20;
    }
    let mut body = vec![0, 4, b'M', b'Q', b'T', b'T', 4, flags, 0, 30];
    put_utf8(&mut body, client_id);
    put_utf8(&mut body, will_topic);
    put_bytes(&mut body, will_payload);
    put_utf8(&mut body, username);
    put_bytes(&mut body, password.as_bytes());
    packet(0x10, body)
}

fn mqtt_subscribe(packet_id: u16, topic: &str) -> Vec<u8> {
    mqtt_subscribe_qos(packet_id, topic, 0)
}

fn mqtt_subscribe_qos(packet_id: u16, topic: &str, qos: u8) -> Vec<u8> {
    let mut body = packet_id.to_be_bytes().to_vec();
    put_utf8(&mut body, topic);
    body.push(qos);
    packet(0x82, body)
}

fn mqtt_publish(topic: &str, payload: &[u8], retain: bool) -> Vec<u8> {
    let mut body = Vec::new();
    put_utf8(&mut body, topic);
    body.extend_from_slice(payload);
    packet(if retain { 0x31 } else { 0x30 }, body)
}

fn mqtt_publish_qos1(packet_id: u16, topic: &str, payload: &[u8], retain: bool) -> Vec<u8> {
    let mut body = Vec::new();
    put_utf8(&mut body, topic);
    body.extend_from_slice(&packet_id.to_be_bytes());
    body.extend_from_slice(payload);
    packet(if retain { 0x33 } else { 0x32 }, body)
}

fn packet(header: u8, body: Vec<u8>) -> Vec<u8> {
    let mut result = vec![header];
    encode_remaining(body.len(), &mut result);
    result.extend(body);
    result
}

fn put_utf8(target: &mut Vec<u8>, value: &str) {
    put_bytes(target, value.as_bytes());
}

fn put_bytes(target: &mut Vec<u8>, value: &[u8]) {
    target.extend_from_slice(&(value.len() as u16).to_be_bytes());
    target.extend_from_slice(value);
}

fn encode_remaining(mut value: usize, target: &mut Vec<u8>) {
    loop {
        let mut byte = (value % 128) as u8;
        value /= 128;
        if value > 0 {
            byte |= 0x80;
        }
        target.push(byte);
        if value == 0 {
            break;
        }
    }
}

fn decode_remaining(bytes: &[u8]) -> (usize, usize) {
    let mut value = 0;
    let mut multiplier = 1;
    for (index, byte) in bytes.iter().copied().enumerate() {
        value += ((byte & 0x7f) as usize) * multiplier;
        if byte & 0x80 == 0 {
            return (value, index + 1);
        }
        multiplier *= 128;
    }
    panic!("invalid MQTT remaining length")
}

fn observer_identity() -> (String, String) {
    let signing_key = SigningKey::from_bytes(&[9; 32]);
    let public_key = hex::encode_upper(signing_key.verifying_key().to_bytes());
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let header = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .encode(br#"{"alg":"Ed25519","typ":"JWT"}"#);
    let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(
        format!(r#"{{"publicKey":"{public_key}","iat":{now},"aud":"integration"}}"#).as_bytes(),
    );
    let input = format!("{header}.{payload}");
    let signature = signing_key.sign(input.as_bytes());
    (
        public_key,
        format!("{input}.{}", hex::encode_upper(signature.to_bytes())),
    )
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn accepted_and_denied_messages_match_role_and_iata_contracts() {
    let broker = start_broker().await;
    let (public_key, token) = observer_identity();
    let mut full = connect(broker.port, "full-client", "full", "secret").await;
    let mut limited = connect(broker.port, "limited-client", "limited", "secret").await;
    let mut observer = connect(
        broker.port,
        "observer-client",
        &format!("v1_{public_key}"),
        &token,
    )
    .await;
    assert_eq!(subscribe(&mut full, 1, "meshcore/#").await, 0);
    assert_eq!(subscribe(&mut limited, 1, "meshcore/#").await, 0);
    assert_eq!(
        subscribe(
            &mut observer,
            1,
            &format!("meshcore/STO/{public_key}/error")
        )
        .await,
        0
    );
    // Denials route through topic matching: the observer must also subscribe
    // to the error topic of the IATA it publishes under to see its codes.
    assert_eq!(
        subscribe(
            &mut observer,
            2,
            &format!("meshcore/ARN/{public_key}/error")
        )
        .await,
        0
    );

    let payload = format!(r#"{{"origin_id":"{public_key}","SNR":9,"raw":"kept"}}"#);
    publish(
        &mut observer,
        &format!("meshcore/sto/{public_key}/packets"),
        payload.as_bytes(),
    )
    .await;

    let (topic, full_payload) = decode_publish(&read_packet(&mut full).await);
    assert_eq!(topic, format!("meshcore/STO/{public_key}/packets"));
    assert_eq!(
        serde_json::from_slice::<Value>(&full_payload).unwrap()["SNR"],
        9
    );
    let (_, limited_payload) = decode_publish(&read_packet(&mut limited).await);
    let limited_payload: Value = serde_json::from_slice(&limited_payload).unwrap();
    assert!(limited_payload.get("SNR").is_none());
    assert_eq!(limited_payload["raw"], "kept");

    publish(
        &mut observer,
        &format!("meshcore/ARN/{public_key}/packets"),
        payload.as_bytes(),
    )
    .await;
    let (error_topic, error_payload) = decode_publish(&read_packet(&mut observer).await);
    assert_eq!(error_topic, format!("meshcore/ARN/{public_key}/error"));
    let error_json: Value = serde_json::from_slice(&error_payload).unwrap();
    assert_eq!(error_json["code"], "PUBLISH_SECONDARY_IATA");
    assert_eq!(error_json["iata"], "ARN");
    assert_eq!(
        error_json["topic"],
        format!("meshcore/ARN/{public_key}/packets")
    );
    // The `at` field must stay an ISO-8601 millisecond timestamp (TS `toISOString()`).
    let at = error_json["at"].as_str().expect("error carries at");
    assert_eq!(at.len(), 24, "unexpected at length: {at}");
    assert!(at.ends_with('Z'), "at must be UTC Zulu, got {at}");
    assert!(at[20..23].bytes().all(|b| b.is_ascii_digit()));
    assert_no_packet(&mut full).await;
    assert_no_packet(&mut limited).await;

    // A denial on a lowercase topic must carry the normalized IATA and a
    // canonical topic in its JSON payload (TypeScript denyPublish parity).
    publish(
        &mut observer,
        &format!("meshcore/sto/{public_key}/status"),
        br#"{"origin_id":"different"}"#,
    )
    .await;
    let (error_topic, error_payload) = decode_publish(&read_packet(&mut observer).await);
    assert_eq!(error_topic, format!("meshcore/STO/{public_key}/error"));
    let error_json: Value = serde_json::from_slice(&error_payload).unwrap();
    assert_eq!(error_json["code"], "PUBLISH_ORIGIN_MISMATCH");
    assert_eq!(error_json["iata"], "STO");
    assert_eq!(
        error_json["topic"],
        format!("meshcore/STO/{public_key}/status")
    );
    assert_no_packet(&mut full).await;
    assert_no_packet(&mut limited).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn last_wills_follow_acl_takeover_and_neighbor_retention_contracts() {
    let broker = start_broker().await;
    let (public_key, token) = observer_identity();
    let username = format!("v1_{public_key}");
    let mut admin = connect(broker.port, "will-admin", "admin", "secret").await;
    let error_topic = format!("meshcore/STO/{public_key}/error");
    assert_eq!(subscribe(&mut admin, 1, &error_topic).await, 0);

    let mut forbidden = websocket(broker.port).await;
    forbidden
        .send(Message::Binary(
            mqtt_connect_with_will(
                "forbidden-will",
                &username,
                &token,
                &error_topic,
                br#"{"forbidden":true}"#,
                true,
            )
            .into(),
        ))
        .await
        .unwrap();
    assert_eq!(
        read_packet(&mut forbidden).await,
        vec![0x20, 0x02, 0x00, 0x00]
    );
    forbidden.close(None).await.unwrap();
    let unexpected = timeout(Duration::from_millis(150), admin.next()).await;
    assert!(
        unexpected.is_err(),
        "unexpected admin frame: {unexpected:?}"
    );

    let neighbors_topic = format!("meshcore/STO/{public_key}/neighbors");
    assert_eq!(subscribe(&mut admin, 2, &neighbors_topic).await, 0);
    let payload = format!(r#"{{"origin_id":"{public_key}"}}"#);

    let mut replaced = websocket(broker.port).await;
    replaced
        .send(Message::Binary(
            mqtt_connect_with_will(
                "replaced-will",
                &username,
                &token,
                &neighbors_topic,
                payload.as_bytes(),
                true,
            )
            .into(),
        ))
        .await
        .unwrap();
    assert_eq!(
        read_packet(&mut replaced).await,
        vec![0x20, 0x02, 0x00, 0x00]
    );
    let mut replacement = connect(broker.port, "replacement-owner", &username, &token).await;
    assert_no_packet(&mut admin).await;
    replacement.close(None).await.unwrap();

    let mut allowed = websocket(broker.port).await;
    allowed
        .send(Message::Binary(
            mqtt_connect_with_will(
                "allowed-will",
                &username,
                &token,
                &neighbors_topic,
                payload.as_bytes(),
                true,
            )
            .into(),
        ))
        .await
        .unwrap();
    assert_eq!(
        read_packet(&mut allowed).await,
        vec![0x20, 0x02, 0x00, 0x00]
    );
    allowed.close(None).await.unwrap();
    let (topic, delivered) = decode_publish(&read_packet(&mut admin).await);
    assert_eq!(topic, neighbors_topic);
    assert_eq!(delivered, payload.as_bytes());

    let mut late = connect(broker.port, "late-will-admin", "admin", "secret").await;
    assert_eq!(subscribe(&mut late, 1, &neighbors_topic).await, 0);
    let retained = read_packet(&mut late).await;
    assert_eq!(retained[0] & 0x01, 0x01);
    let (topic, delivered) = decode_publish(&retained);
    assert_eq!(topic, neighbors_topic);
    assert_eq!(delivered, payload.as_bytes());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn stale_status_last_will_has_no_subscriber_target_or_meshcore_effect() {
    let sink = Arc::new(RecordingTarget::default());
    sink.connected.store(true, Ordering::Release);
    let target = TargetBridge::with_sink(
        TargetMqttConfig {
            enabled: true,
            url: "mqtt://target.invalid:1883".into(),
            ..Default::default()
        },
        "will-stale-target".into(),
        sink.clone(),
    );
    let meshcore = MeshcoreIoRuntime::with_poster(
        MeshcoreIoConfig {
            enabled: true,
            ..Default::default()
        },
        Arc::new(NoopPoster),
        false,
    );
    let broker =
        start_broker_with_integrations(None, Some(target.clone()), Some(meshcore.clone())).await;
    let (public_key, token) = observer_identity();
    let username = format!("v1_{public_key}");
    let topic = format!("meshcore/STO/{public_key}/status");
    let mut admin = connect(broker.port, "stale-will-admin", "admin", "secret").await;
    assert_eq!(subscribe(&mut admin, 1, &topic).await, 0);
    let mut observer = connect(broker.port, "status-owner", &username, &token).await;
    let newer = format!(r#"{{"origin_id":"{public_key}","timestamp":2000}}"#);
    publish(&mut observer, &topic, newer.as_bytes()).await;
    let (_, delivered) = decode_publish(&read_packet(&mut admin).await);
    assert_eq!(delivered, newer.as_bytes());
    for _ in 0..100 {
        if sink.writes.lock().unwrap().len() == 1 {
            break;
        }
        sleep(Duration::from_millis(2)).await;
    }
    assert_eq!(sink.writes.lock().unwrap().len(), 1);
    assert_eq!(meshcore.stats().ingress_pending, 1);
    observer.close(None).await.unwrap();

    let older = format!(r#"{{"origin_id":"{public_key}","timestamp":1000}}"#);
    let mut stale_will = websocket(broker.port).await;
    stale_will
        .send(Message::Binary(
            mqtt_connect_with_will(
                "stale-status-will",
                &username,
                &token,
                &topic,
                older.as_bytes(),
                false,
            )
            .into(),
        ))
        .await
        .unwrap();
    assert_eq!(
        read_packet(&mut stale_will).await,
        vec![0x20, 0x02, 0x00, 0x00]
    );
    stale_will.close(None).await.unwrap();
    assert_no_packet(&mut admin).await;
    sleep(Duration::from_millis(20)).await;
    assert_eq!(sink.writes.lock().unwrap().len(), 1);
    assert_eq!(meshcore.stats().ingress_pending, 1);
    target.stop().await;
    meshcore.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn private_serial_routing_and_session_takeover_match_contract() {
    let broker = start_broker().await;
    let (public_key, token) = observer_identity();
    let mut full = connect(broker.port, "full-client", "full", "secret").await;
    let mut admin = connect(broker.port, "admin-client", "admin", "secret").await;
    let mut observer = connect(
        broker.port,
        "observer-old",
        &format!("v1_{public_key}"),
        &token,
    )
    .await;
    assert_eq!(subscribe(&mut full, 1, "meshcore/#").await, 0);
    assert_eq!(
        subscribe(
            &mut observer,
            1,
            &format!("meshcore/STO/{public_key}/serial/commands")
        )
        .await,
        0
    );

    publish(
        &mut admin,
        &format!("meshcore/STO/{public_key}/serial/commands"),
        b"command",
    )
    .await;
    let (topic, payload) = decode_publish(&read_packet(&mut observer).await);
    assert_eq!(topic, format!("meshcore/STO/{public_key}/serial/commands"));
    assert_eq!(payload, b"command");
    assert_no_packet(&mut full).await;

    let _new_observer = connect(
        broker.port,
        "observer-new",
        &format!("v1_{public_key}"),
        &token,
    )
    .await;
    let closed = timeout(Duration::from_secs(2), observer.next())
        .await
        .expect("old observer was not closed after takeover");
    assert!(
        closed.is_none()
            || closed.is_some_and(|message| message.is_err() || message.unwrap().is_close())
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn observer_subscribing_to_a_reserved_topic_is_disconnected() {
    let broker = start_broker().await;
    let (public_key, token) = observer_identity();
    let mut observer = connect(
        broker.port,
        "reserved-sub-observer",
        &format!("v1_{public_key}"),
        &token,
    )
    .await;
    // Observers may only subscribe to their own error and serial/commands
    // topics; anything else is denied and the legacy broker closed the socket.
    assert_eq!(
        subscribe(
            &mut observer,
            1,
            &format!("meshcore/STO/{public_key}/status")
        )
        .await,
        0x80 // MQTT 3.1.1 SUBACK failure
    );
    let closed = timeout(Duration::from_secs(2), observer.next())
        .await
        .expect("observer was not closed after a reserved-topic subscribe");
    assert!(
        closed.is_none()
            || closed.is_some_and(|message| message.is_err() || message.unwrap().is_close())
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn mqtt_path_accepts_qos1_subscribe_and_publish() {
    let broker = start_broker().await;
    let (public_key, token) = observer_identity();

    // Beacon/Paho-style subscriber uses the /mqtt WebSocket path and asks for
    // a QoS 1 meshcore/# subscription.
    let mut subscriber = connect_path(broker.port, "/mqtt", "qos1-full", "full", "secret").await;
    subscriber
        .send(Message::Binary(
            mqtt_subscribe_qos(1, "meshcore/#", 1).into(),
        ))
        .await
        .unwrap();
    let suback = read_packet(&mut subscriber).await;
    assert_eq!(suback[0], 0x90, "expected SUBACK");
    assert_eq!(
        *suback.last().unwrap(),
        0x01,
        "QoS 1 request must grant QoS 1"
    );

    // The observer connects over /mqtt and publishes a QoS 1 status, which
    // must be acknowledged with a PUBACK.
    let mut observer = connect_path(
        broker.port,
        "/mqtt",
        "qos1-observer",
        &format!("v1_{public_key}"),
        &token,
    )
    .await;
    let status_topic = format!("meshcore/STO/{public_key}/status");
    let status = format!(r#"{{"origin_id":"{public_key}","SNR":7}}"#);
    observer
        .send(Message::Binary(
            mqtt_publish_qos1(2, &status_topic, status.as_bytes(), false).into(),
        ))
        .await
        .unwrap();
    read_puback(&mut observer, 2).await;

    let (topic, payload) = decode_publish(&read_packet(&mut subscriber).await);
    assert_eq!(topic, status_topic);
    assert_eq!(serde_json::from_slice::<Value>(&payload).unwrap()["SNR"], 7);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn legacy_wire_matrix_covers_auth_qos0_denial_and_reconnect() {
    let broker = start_broker().await;
    let (public_key, token) = observer_identity();
    let username = format!("v1_{public_key}");
    let matrix: Value = serde_json::from_str(include_str!("fixtures/legacy-wire-matrix.json"))
        .expect("legacy wire matrix must be valid JSON");
    let case = |id: &str| {
        matrix["cases"]
            .as_array()
            .expect("matrix cases must be an array")
            .iter()
            .find(|case| case["id"] == id)
            .unwrap_or_else(|| panic!("missing legacy wire case {id}"))
    };

    let mut rejected = websocket_path(broker.port, "/mqtt").await;
    rejected
        .send(Message::Binary(
            mqtt_connect("bad-auth", &username, "not-a-token").into(),
        ))
        .await
        .unwrap();
    assert_eq!(
        read_packet(&mut rejected).await,
        hex::decode(
            case("mqtt311-invalid-observer-auth")["connackHex"]
                .as_str()
                .expect("CONNACK fixture must be a string")
        )
        .expect("CONNACK fixture must be hexadecimal"),
        "legacy MQTT 3.1.1 auth denial is CONNACK return code 5"
    );

    let mut observer =
        connect_path(broker.port, "/mqtt", "matrix-observer", &username, &token).await;
    let error_topic = format!("meshcore/STO/{public_key}/error");
    assert_eq!(subscribe(&mut observer, 1, &error_topic).await, 0);

    let mut beacon = connect_path(broker.port, "/mqtt", "matrix-beacon", "full", "secret").await;
    beacon
        .send(Message::Binary(
            mqtt_subscribe_qos(1, "meshcore/#", 1).into(),
        ))
        .await
        .unwrap();
    assert_eq!(*read_packet(&mut beacon).await.last().unwrap(), 1);

    let fixtures = matrix["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|case| case.get("publish"));
    for fixture in fixtures {
        let subtopic = fixture["subtopic"].as_str().unwrap();
        let payload = fixture["payloadTemplate"]
            .as_str()
            .unwrap()
            .replace("{publicKey}", &public_key);
        let retain = fixture["retain"].as_bool().unwrap();
        let topic = format!("meshcore/STO/{public_key}/{subtopic}");
        publish_with_retain(&mut observer, &topic, payload.as_bytes(), retain).await;
        let delivered = read_packet(&mut beacon).await;
        assert_eq!(delivered[0] & 0x06, 0, "QoS 0 publish changed QoS");
        assert_eq!(
            decode_publish(&delivered),
            (topic, payload.as_bytes().to_vec())
        );
    }
    assert_no_packet(&mut observer).await;

    publish(
        &mut observer,
        &format!("meshcore/STO/{public_key}/packets"),
        b"not-json",
    )
    .await;
    let (topic, payload) = decode_publish(&read_packet(&mut observer).await);
    assert_eq!(topic, error_topic);
    assert_eq!(
        serde_json::from_slice::<Value>(&payload).unwrap()["code"],
        case("observer-invalid-json-error")["errorCode"]
    );
    assert_no_packet(&mut beacon).await;

    beacon.close(None).await.unwrap();
    let mut reconnected = connect_path(
        broker.port,
        "/mqtt",
        "matrix-beacon-reconnected",
        "full",
        "secret",
    )
    .await;
    reconnected
        .send(Message::Binary(
            mqtt_subscribe_qos(2, "meshcore/#", 1).into(),
        ))
        .await
        .unwrap();
    assert_eq!(*read_packet(&mut reconnected).await.last().unwrap(), 1);
    let replay = read_packet(&mut reconnected).await;
    assert_eq!(replay[0] & 1, 1);
    let (topic, payload) = decode_publish(&replay);
    assert_eq!(topic, format!("meshcore/STO/{public_key}/neighbors"));
    let payload: Value = serde_json::from_slice(&payload).unwrap();
    assert_eq!(payload["neighbors"][0]["SNR"], 9);
}

#[test]
fn legacy_wire_matrix_is_versioned_complete_and_explicit_about_differences() {
    let matrix: Value = serde_json::from_str(include_str!("fixtures/legacy-wire-matrix.json"))
        .expect("legacy wire matrix must be valid JSON");
    assert_eq!(matrix["schemaVersion"], 1);
    assert_eq!(
        matrix["legacySource"],
        "1eeadba773488d91fc65c2f673cbe40c8a28795e"
    );
    let cases = matrix["cases"].as_array().expect("cases must be an array");
    let mut ids = HashSet::new();
    for case in cases {
        let id = case["id"].as_str().expect("case id must be a string");
        assert!(ids.insert(id), "duplicate matrix case {id}");
        for field in ["category", "legacyExpectation", "rustResult", "test"] {
            assert!(
                case[field].as_str().is_some_and(|value| !value.is_empty()),
                "matrix case {id} is missing {field}"
            );
        }
        if case["legacyExpectation"] != case["rustResult"] {
            assert!(
                case["intentionalDifference"]
                    .as_str()
                    .is_some_and(|reason| !reason.is_empty()),
                "matrix case {id} differs without a documented reason"
            );
        }
    }
    for required in [
        "mqtt311-invalid-observer-auth",
        "observer-jwt-time-boundaries",
        "observer-session-takeover",
        "beacon-full-access-qos1-subscribe",
        "observer-invalid-json-error",
        "private-route-visibility",
        "limited-live-and-retained-projection",
        "last-will-authorization",
        "mqtt5-message-expiry",
        "incoming-retain-controls-storage",
        "target-retain-pass-through",
    ] {
        assert!(ids.contains(required), "matrix is missing {required}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn retained_neighbors_are_filtered_per_role_without_mutating_stored_payload() {
    let broker = start_broker().await;
    let (public_key, token) = observer_identity();
    let mut observer = connect(
        broker.port,
        "retained-observer",
        &format!("v1_{public_key}"),
        &token,
    )
    .await;
    let neighbors_topic = format!("meshcore/STO/{public_key}/neighbors");
    let neighbors = format!(
        r#"{{"origin_id":"{public_key}","neighbors":[{{"id":"kept","SNR":9,"rssi":8,"score":7}}]}}"#
    );
    publish_with_retain(&mut observer, &neighbors_topic, neighbors.as_bytes(), true).await;
    sleep(Duration::from_millis(30)).await;

    let mut limited = connect(broker.port, "retained-limited", "limited", "secret").await;
    assert_eq!(subscribe(&mut limited, 1, &neighbors_topic).await, 0);
    let limited_packet = read_packet(&mut limited).await;
    assert_eq!(limited_packet[0] & 0x01, 0x01);
    let (_, limited_payload) = decode_publish(&limited_packet);
    let limited_payload: Value = serde_json::from_slice(&limited_payload).unwrap();
    assert_eq!(limited_payload["neighbors"][0]["id"], "kept");
    assert!(limited_payload["neighbors"][0].get("SNR").is_none());
    assert!(limited_payload["neighbors"][0].get("rssi").is_none());
    assert!(limited_payload["neighbors"][0].get("score").is_none());

    let mut full = connect(broker.port, "retained-full", "full", "secret").await;
    assert_eq!(subscribe(&mut full, 1, &neighbors_topic).await, 0);
    let full_packet = read_packet(&mut full).await;
    assert_eq!(full_packet[0] & 0x01, 0x01);
    let (_, full_payload) = decode_publish(&full_packet);
    let full_payload: Value = serde_json::from_slice(&full_payload).unwrap();
    assert_eq!(full_payload["neighbors"][0]["SNR"], 9);
    assert_eq!(full_payload["neighbors"][0]["rssi"], 8);
    assert_eq!(full_payload["neighbors"][0]["score"], 7);

    let packets_topic = format!("meshcore/STO/{public_key}/packets");
    let packets = format!(r#"{{"origin_id":"{public_key}","raw":"retained-packet"}}"#);
    publish_with_retain(&mut observer, &packets_topic, packets.as_bytes(), true).await;
    sleep(Duration::from_millis(30)).await;
    assert_eq!(subscribe(&mut full, 2, &packets_topic).await, 0);
    let retained_packet = read_packet(&mut full).await;
    assert_eq!(retained_packet[0] & 1, 1);
    let (replayed_topic, replayed_payload) = decode_publish(&retained_packet);
    assert_eq!(replayed_topic, packets_topic);
    assert_eq!(replayed_payload, packets.as_bytes());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn nonretained_updates_do_not_replace_retained_status_and_explicit_clear_removes_it() {
    let broker = start_broker().await;
    let (public_key, token) = observer_identity();
    let topic = format!("meshcore/STO/{public_key}/status");
    let mut observer = connect(
        broker.port,
        "retain-owner",
        &format!("v1_{public_key}"),
        &token,
    )
    .await;
    let first = format!(r#"{{"origin_id":"{public_key}","timestamp":"2026-01-01T00:00:00Z"}}"#);
    let second = format!(r#"{{"origin_id":"{public_key}","timestamp":"2026-01-02T00:00:00Z"}}"#);
    publish_with_retain(&mut observer, &topic, first.as_bytes(), true).await;
    sleep(Duration::from_millis(30)).await;
    publish_with_retain(&mut observer, &topic, second.as_bytes(), false).await;
    sleep(Duration::from_millis(30)).await;
    let mut late = connect(broker.port, "retain-late", "full", "secret").await;
    assert_eq!(subscribe(&mut late, 1, &topic).await, 0);
    let replay = read_packet(&mut late).await;
    assert_eq!(replay[0] & 1, 1);
    assert_eq!(decode_publish(&replay).1, first.as_bytes());

    // A zero-length retained publish is a legal MQTT clear even though
    // ordinary telemetry requires origin_id-bearing JSON.
    publish_with_retain(&mut observer, &topic, b"", true).await;
    sleep(Duration::from_millis(30)).await;
    let mut after_clear = connect(broker.port, "retain-cleared", "full", "secret").await;
    assert_eq!(subscribe(&mut after_clear, 1, &topic).await, 0);
    assert_no_packet(&mut after_clear).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn heartbeat_publishes_immediately_then_periodically_per_role() {
    let mut broker = start_broker_with_heartbeat(None).await;
    let mut full = connect(broker.port, "heartbeat-full", "full", "secret").await;
    let mut limited = connect(broker.port, "heartbeat-limited", "limited", "secret").await;
    let mut admin = connect(broker.port, "heartbeat-admin", "admin", "secret").await;
    for (index, socket) in [&mut full, &mut limited, &mut admin].iter_mut().enumerate() {
        assert_eq!(subscribe(socket, 1 + index as u16, "heartbeat/").await, 0);
        assert_no_packet(socket).await;
    }

    // Spawn the heartbeat after subscribing: the first publish must arrive
    // immediately, mirroring the legacy publish-at-start behavior.
    broker.spawn_heartbeat(Duration::from_millis(150));
    for socket in [&mut full, &mut limited, &mut admin] {
        let packet = read_packet(socket).await;
        assert_eq!(packet[0] & 0x01, 0x00);
        let (topic, payload) = decode_publish(&packet);
        assert_eq!(topic, "heartbeat/");
        assert_eq!(payload, "Hjärtat slår".as_bytes());
    }

    // The periodic republish reaches the same subscriptions.
    for socket in [&mut full, &mut limited, &mut admin] {
        let packet = read_packet(socket).await;
        let (topic, payload) = decode_publish(&packet);
        assert_eq!(topic, "heartbeat/");
        assert_eq!(payload, "Hjärtat slår".as_bytes());
    }

    // Observers cannot subscribe to the heartbeat topic at all.
    let (public_key, token) = observer_identity();
    let mut observer = connect(
        broker.port,
        "heartbeat-observer",
        &format!("v1_{public_key}"),
        &token,
    )
    .await;
    assert_ne!(subscribe(&mut observer, 1, "heartbeat/").await, 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn stale_status_is_denied_with_code_and_never_delivered() {
    let broker = start_broker().await;
    let (public_key, token) = observer_identity();
    let mut observer = connect(
        broker.port,
        "stale-observer",
        &format!("v1_{public_key}"),
        &token,
    )
    .await;
    let mut full = connect(broker.port, "stale-full", "full", "secret").await;
    assert_eq!(subscribe(&mut full, 1, "meshcore/#").await, 0);
    assert_eq!(
        subscribe(
            &mut observer,
            1,
            &format!("meshcore/STO/{public_key}/error")
        )
        .await,
        0
    );

    let status_topic = format!("meshcore/STO/{public_key}/status");
    let status =
        |timestamp: &str| format!(r#"{{"origin_id":"{public_key}","timestamp":"{timestamp}"}}"#);

    publish(
        &mut observer,
        &status_topic,
        status("2026-01-02T00:00:00.000Z").as_bytes(),
    )
    .await;
    let (topic, _) = decode_publish(&read_packet(&mut full).await);
    assert_eq!(topic, status_topic);

    // Equal device timestamps are accepted, not rejected.
    publish(
        &mut observer,
        &status_topic,
        status("2026-01-02T00:00:00.000Z").as_bytes(),
    )
    .await;
    let (topic, _) = decode_publish(&read_packet(&mut full).await);
    assert_eq!(topic, status_topic);

    // An older device timestamp is denied with PUBLISH_STALE_STATUS on the
    // observer error topic; the stale packet itself is never delivered.
    publish(
        &mut observer,
        &status_topic,
        status("2026-01-01T00:00:00.000Z").as_bytes(),
    )
    .await;
    let (error_topic, error_payload) = decode_publish(&read_packet(&mut observer).await);
    assert_eq!(error_topic, format!("meshcore/STO/{public_key}/error"));
    assert_eq!(
        serde_json::from_slice::<Value>(&error_payload).unwrap()["code"],
        "PUBLISH_STALE_STATUS"
    );
    assert_no_packet(&mut full).await;

    // Missing timestamps skip the guard and are delivered.
    publish(
        &mut observer,
        &status_topic,
        format!(r#"{{"origin_id":"{public_key}"}}"#).as_bytes(),
    )
    .await;
    let (topic, _) = decode_publish(&read_packet(&mut full).await);
    assert_eq!(topic, status_topic);

    // A newer device timestamp recovers acceptance.
    publish(
        &mut observer,
        &status_topic,
        status("2026-01-03T00:00:00.000Z").as_bytes(),
    )
    .await;
    let (topic, _) = decode_publish(&read_packet(&mut full).await);
    assert_eq!(topic, status_topic);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn publish_denials_route_to_the_iata_the_observer_used() {
    let broker = start_broker().await;
    let (public_key, token) = observer_identity();
    let mut observer = connect(
        broker.port,
        "denial-iata",
        &format!("v1_{public_key}"),
        &token,
    )
    .await;
    assert_eq!(
        subscribe(
            &mut observer,
            1,
            &format!("meshcore/STO/{public_key}/error")
        )
        .await,
        0
    );
    assert_eq!(
        subscribe(
            &mut observer,
            2,
            &format!("meshcore/XXX/{public_key}/error")
        )
        .await,
        0
    );

    // Invalid JSON on an allowed-IATA topic: the denial lands on the same
    // IATA error topic the observer used, not the XXX placeholder.
    publish(
        &mut observer,
        &format!("meshcore/STO/{public_key}/packets"),
        b"not-json",
    )
    .await;
    let (topic, payload) = decode_publish(&read_packet(&mut observer).await);
    assert_eq!(topic, format!("meshcore/STO/{public_key}/error"));
    assert_eq!(
        serde_json::from_slice::<Value>(&payload).unwrap()["code"],
        "PUBLISH_INVALID_JSON"
    );

    // A topic outside meshcore/ has no recoverable IATA: the denial falls
    // back to the XXX placeholder topic.
    publish(&mut observer, "other/topic", b"{}").await;
    let (topic, payload) = decode_publish(&read_packet(&mut observer).await);
    assert_eq!(topic, format!("meshcore/XXX/{public_key}/error"));
    assert_eq!(
        serde_json::from_slice::<Value>(&payload).unwrap()["code"],
        "PUBLISH_NOT_MESHCORE_TOPIC"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn error_notifications_route_through_subscriptions_with_role_visibility() {
    let broker = start_broker().await;
    let (public_key, token) = observer_identity();
    let mut admin = connect(broker.port, "notify-admin", "admin", "secret").await;
    let mut full = connect(broker.port, "notify-full", "full", "secret").await;
    let mut observer = connect(
        broker.port,
        "notify-observer",
        &format!("v1_{public_key}"),
        &token,
    )
    .await;
    assert_eq!(subscribe(&mut admin, 1, "meshcore/#").await, 0);
    assert_eq!(subscribe(&mut full, 1, "meshcore/#").await, 0);
    assert_eq!(
        subscribe(
            &mut observer,
            1,
            &format!("meshcore/STO/{public_key}/error")
        )
        .await,
        0
    );

    // A denied publish notifies the observer on its own error subscription
    // and admin meshcore/# subscribers; limited/full subscribers must not
    // see the private error payload.
    publish(
        &mut observer,
        &format!("meshcore/STO/{public_key}/packets"),
        b"not-json",
    )
    .await;
    for socket in [&mut observer, &mut admin] {
        let (topic, payload) = decode_publish(&read_packet(socket).await);
        assert_eq!(topic, format!("meshcore/STO/{public_key}/error"));
        assert_eq!(
            serde_json::from_slice::<Value>(&payload).unwrap()["code"],
            "PUBLISH_INVALID_JSON"
        );
    }
    assert_no_packet(&mut full).await;

    // A closing denial (publish under another key) still flushes the
    // notification to the socket before the connection is closed.
    publish(
        &mut observer,
        &format!("meshcore/STO/{}/packets", "0".repeat(64)),
        b"{}",
    )
    .await;
    let (topic, payload) = decode_publish(&read_packet(&mut observer).await);
    assert_eq!(topic, format!("meshcore/STO/{public_key}/error"));
    assert_eq!(
        serde_json::from_slice::<Value>(&payload).unwrap()["code"],
        "PUBLISH_KEY_MISMATCH"
    );
    let closed = timeout(Duration::from_secs(2), observer.next())
        .await
        .expect("observer was not closed after key-mismatch denial");
    assert!(
        closed.is_none()
            || closed.is_some_and(|message| message.is_err() || message.unwrap().is_close())
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn retained_messages_do_not_expire_implicitly_and_reset_on_new_broker() {
    let broker = start_broker().await;
    let (key, token) = observer_identity();
    let topic = format!("meshcore/STO/{key}/neighbors");
    let mut observer = connect(broker.port, "ram-owner", &format!("v1_{key}"), &token).await;
    let payload = format!(r#"{{"origin_id":"{key}","neighbors":[]}}"#);
    publish_with_retain(&mut observer, &topic, payload.as_bytes(), true).await;
    sleep(Duration::from_millis(250)).await;
    let mut late = connect(broker.port, "ram-late", "full", "secret").await;
    assert_eq!(subscribe(&mut late, 1, &topic).await, 0);
    let replay = read_packet(&mut late).await;
    assert_eq!(replay[0] & 1, 1);
    assert_eq!(decode_publish(&replay).1, payload.as_bytes());

    // No durable database: a new broker process has an empty retained store.
    drop(broker);
    let replacement = start_broker().await;
    let mut new_late = connect(replacement.port, "fresh-ram", "full", "secret").await;
    assert_eq!(subscribe(&mut new_late, 1, &topic).await, 0);
    assert_no_packet(&mut new_late).await;
}
