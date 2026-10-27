use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use futures_util::{SinkExt, StreamExt};
use meshcore_mqtt_broker::config::{Config, Subscriber, SubscriberRole};
use meshcore_mqtt_broker::heartbeat::{BROKER_HEARTBEAT_INTERVAL, HeartbeatPublisher};
use meshcore_mqtt_broker::retained::{
    NEIGHBOR_RETENTION, RETAINED_NEIGHBOR_CAPACITY, RetainedNeighbors,
};
use meshcore_mqtt_broker::rmqtt_handler::MeshcoreHandler;
use meshcore_mqtt_broker::routing::RoleRouter;
use rmqtt::context::ServerContext;
use rmqtt::net::Builder;
use rmqtt::server::MqttServer;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener};
use std::sync::Arc;
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
    retained_task: JoinHandle<()>,
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
        self.retained_task.abort();
        if let Some(task) = self.heartbeat_task.take() {
            task.abort();
        }
    }
}

async fn start_broker() -> Broker {
    start_broker_with_retention(RETAINED_NEIGHBOR_CAPACITY, NEIGHBOR_RETENTION).await
}

async fn start_broker_with_retention(capacity: usize, retention: Duration) -> Broker {
    start_broker_with_heartbeat(capacity, retention, Some(BROKER_HEARTBEAT_INTERVAL)).await
}

async fn start_broker_with_heartbeat(
    capacity: usize,
    retention: Duration,
    heartbeat_interval: Option<Duration>,
) -> Broker {
    let port = {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        listener.local_addr().unwrap().port()
    };
    let config = Arc::new(Config {
        listener: SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port),
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
    *scx.extends.router_mut().await = Box::new(RoleRouter::new(scx.clone(), config.clone()));
    let retained = RetainedNeighbors::new(scx.clone(), capacity, retention);
    retained.install().await;
    let retained_task = retained.spawn_expiry();
    let handler = MeshcoreHandler::new(config.clone(), scx.clone());
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
        retained_task,
        heartbeat_task,
        _registration: registration,
    }
}

async fn websocket(port: u16) -> Socket {
    let mut request = format!("ws://127.0.0.1:{port}/")
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
    let mut socket = websocket(port).await;
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
    let (remaining, offset) = decode_remaining(&packet[1..]);
    let body = &packet[1 + offset..1 + offset + remaining];
    let topic_len = u16::from_be_bytes([body[0], body[1]]) as usize;
    let topic = String::from_utf8(body[2..2 + topic_len].to_vec()).unwrap();
    (topic, body[2 + topic_len..].to_vec())
}

fn mqtt_connect(client_id: &str, username: &str, password: &str) -> Vec<u8> {
    let mut body = vec![0, 4, b'M', b'Q', b'T', b'T', 4, 0xc2, 0, 30];
    put_utf8(&mut body, client_id);
    put_utf8(&mut body, username);
    put_bytes(&mut body, password.as_bytes());
    packet(0x10, body)
}

fn mqtt_subscribe(packet_id: u16, topic: &str) -> Vec<u8> {
    let mut body = packet_id.to_be_bytes().to_vec();
    put_utf8(&mut body, topic);
    body.push(0);
    packet(0x82, body)
}

fn mqtt_publish(topic: &str, payload: &[u8], retain: bool) -> Vec<u8> {
    let mut body = Vec::new();
    put_utf8(&mut body, topic);
    body.extend_from_slice(payload);
    packet(if retain { 0x31 } else { 0x30 }, body)
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
    assert_eq!(
        serde_json::from_slice::<Value>(&error_payload).unwrap()["code"],
        "PUBLISH_SECONDARY_IATA"
    );
    assert_no_packet(&mut full).await;
    assert_no_packet(&mut limited).await;
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
    publish(&mut observer, &neighbors_topic, neighbors.as_bytes()).await;
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
    let packets = format!(r#"{{"origin_id":"{public_key}","raw":"not-retained"}}"#);
    publish_with_retain(&mut observer, &packets_topic, packets.as_bytes(), true).await;
    sleep(Duration::from_millis(30)).await;
    assert_eq!(subscribe(&mut full, 2, &packets_topic).await, 0);
    assert_no_packet(&mut full).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn retained_neighbor_capacity_uses_least_recently_refreshed_topic() {
    let broker = start_broker_with_retention(2, Duration::from_secs(60)).await;
    let (public_key, token) = observer_identity();
    let mut observer = connect(
        broker.port,
        "lru-observer",
        &format!("v1_{public_key}"),
        &token,
    )
    .await;
    let payload = format!(r#"{{"origin_id":"{public_key}","neighbors":[]}}"#);
    for iata in ["STO", "GOT", "STO", "MMX"] {
        publish(
            &mut observer,
            &format!("meshcore/{iata}/{public_key}/neighbors"),
            payload.as_bytes(),
        )
        .await;
    }
    sleep(Duration::from_millis(50)).await;

    let mut full = connect(broker.port, "lru-full", "full", "secret").await;
    assert_eq!(subscribe(&mut full, 1, "meshcore/#").await, 0);
    let mut topics = Vec::new();
    for _ in 0..2 {
        let (topic, _) = decode_publish(&read_packet(&mut full).await);
        topics.push(topic);
    }
    topics.sort();
    assert_eq!(
        topics,
        [
            format!("meshcore/MMX/{public_key}/neighbors"),
            format!("meshcore/STO/{public_key}/neighbors"),
        ]
    );
    assert_no_packet(&mut full).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn heartbeat_publishes_immediately_then_periodically_per_role() {
    let mut broker = start_broker_with_heartbeat(10, Duration::from_secs(60), None).await;
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
async fn retained_neighbors_expire_notify_and_cannot_be_replayed() {
    let broker = start_broker_with_retention(10, Duration::from_millis(200)).await;
    let (public_key, token) = observer_identity();
    let topic = format!("meshcore/STO/{public_key}/neighbors");
    let mut full = connect(broker.port, "expiry-full", "full", "secret").await;
    assert_eq!(subscribe(&mut full, 1, &topic).await, 0);
    let mut observer = connect(
        broker.port,
        "expiry-observer",
        &format!("v1_{public_key}"),
        &token,
    )
    .await;
    let payload = format!(r#"{{"origin_id":"{public_key}","neighbors":[]}}"#);
    publish(&mut observer, &topic, payload.as_bytes()).await;
    let (_, initial_payload) = decode_publish(&read_packet(&mut full).await);
    assert!(!initial_payload.is_empty());

    let clear_packet = read_packet(&mut full).await;
    let (clear_topic, clear_payload) = decode_publish(&clear_packet);
    assert_eq!(clear_topic, topic);
    assert!(clear_payload.is_empty());

    let mut late = connect(broker.port, "expiry-late", "full", "secret").await;
    assert_eq!(subscribe(&mut late, 1, &topic).await, 0);
    assert_no_packet(&mut late).await;
}
