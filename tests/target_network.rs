use bytes::Bytes;
use meshcore_mqtt_broker::config::TargetMqttConfig;
use meshcore_mqtt_broker::retained::RetainedNeighbors;
use meshcore_mqtt_broker::target_bridge::TargetBridge;
use rmqtt::context::ServerContext;
use rmqtt::net::Builder;
use rmqtt::server::MqttServer;
use rumqttc::{AsyncClient, Event, Incoming, MqttOptions, Publish, QoS};
use std::net::{Ipv4Addr, TcpListener};
use std::time::Duration;

const KEY: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

async fn next_publish(eventloop: &mut rumqttc::EventLoop) -> Publish {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Event::Incoming(Incoming::Publish(publish)) = eventloop.poll().await.unwrap() {
                return publish;
            }
        }
    })
    .await
    .expect("target subscriber timed out")
}

async fn wait_for_suback(eventloop: &mut rumqttc::EventLoop) {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if matches!(
                eventloop.poll().await.unwrap(),
                Event::Incoming(Incoming::SubAck(_))
            ) {
                return;
            }
        }
    })
    .await
    .expect("target subscription timed out");
}

#[tokio::test]
async fn target_bridge_publishes_in_order_and_replays_retained_neighbors() {
    let port = {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        listener.local_addr().unwrap().port()
    };
    let context = ServerContext::new().build().await;
    let retained = RetainedNeighbors::new(context.clone());
    retained.install().await;
    let listener = Builder::new()
        .name("target-test/tcp")
        .laddr((Ipv4Addr::LOCALHOST, port).into())
        .allow_anonymous(true)
        .bind()
        .unwrap()
        .tcp()
        .unwrap();
    let broker = tokio::spawn(MqttServer::new(context).listener(listener).build().run());

    let options = MqttOptions::new("target-test-live", Ipv4Addr::LOCALHOST.to_string(), port);
    let (subscriber, mut events) = AsyncClient::new(options, 10);
    subscriber
        .subscribe("meshcore/#", QoS::AtMostOnce)
        .await
        .unwrap();
    wait_for_suback(&mut events).await;
    subscriber
        .publish("meshcore/probe", QoS::AtMostOnce, false, b"probe")
        .await
        .unwrap();
    assert_eq!(next_publish(&mut events).await.payload.as_ref(), b"probe");

    let bridge = TargetBridge::start(
        TargetMqttConfig {
            enabled: true,
            url: format!("mqtt://127.0.0.1:{port}"),
            reconnect_period_ms: 50,
            connect_timeout_ms: 1_000,
            ..Default::default()
        },
        "target-test-bridge".into(),
    )
    .unwrap()
    .unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        while !bridge.status().connected {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("target bridge did not connect");

    let status_topic = format!("meshcore/STO/{KEY}/status");
    let neighbors_topic = format!("meshcore/STO/{KEY}/neighbors");
    bridge.offer_publish(KEY, &status_topic, Bytes::from_static(b"status"));
    bridge.offer_publish_with_retain(
        KEY,
        &neighbors_topic,
        Bytes::from_static(b"neighbors"),
        true,
    );

    tokio::time::timeout(Duration::from_secs(5), async {
        while bridge.status().successful_messages != 2 && bridge.status().dropped_messages == 0 {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("target counters did not settle");
    assert_eq!(bridge.status().successful_messages, 2);
    assert_eq!(bridge.status().dropped_messages, 0);

    let first = next_publish(&mut events).await;
    let second = next_publish(&mut events).await;
    assert_eq!(
        (first.topic, first.payload.as_ref()),
        (status_topic, b"status".as_slice())
    );
    assert!(!first.retain);
    assert_eq!(
        (second.topic, second.payload.as_ref()),
        (neighbors_topic.clone(), b"neighbors".as_slice())
    );

    let late_options = MqttOptions::new("target-test-late", Ipv4Addr::LOCALHOST.to_string(), port);
    let (late, mut late_events) = AsyncClient::new(late_options, 10);
    late.subscribe(&neighbors_topic, QoS::AtMostOnce)
        .await
        .unwrap();
    let replay = next_publish(&mut late_events).await;
    assert_eq!(replay.topic, neighbors_topic);
    assert_eq!(replay.payload.as_ref(), b"neighbors");
    assert!(replay.retain);

    bridge.stop().await;
    broker.abort();
}
