use meshcore_mqtt_broker::config::Config;
use meshcore_mqtt_broker::meshcore_io::MeshcoreIoRuntime;
use meshcore_mqtt_broker::retained::{
    NEIGHBOR_RETENTION, RETAINED_NEIGHBOR_CAPACITY, RetainedNeighbors,
};
use meshcore_mqtt_broker::rmqtt_handler::MeshcoreHandler;
use meshcore_mqtt_broker::routing::RoleRouter;
use meshcore_mqtt_broker::target_bridge::TargetBridge;
use rmqtt::context::ServerContext;
use rmqtt::net::Builder;
use rmqtt::server::MqttServer;
use std::sync::Arc;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let config = Arc::new(Config::discover()?);
    let scx = ServerContext::new().build().await;
    *scx.extends.router_mut().await = Box::new(RoleRouter::new(scx.clone(), config.clone()));
    let retained =
        RetainedNeighbors::new(scx.clone(), RETAINED_NEIGHBOR_CAPACITY, NEIGHBOR_RETENTION);
    retained.install().await;
    let _retained_expiry = retained.spawn_expiry();
    let instance_id = format!("{}-{}", config.broker_name, uuid::Uuid::new_v4());
    let target = TargetBridge::start(config.target_mqtt.clone(), instance_id)
        .map_err(std::io::Error::other)?;
    let meshcore_io =
        MeshcoreIoRuntime::start(config.meshcore_io.clone()).map_err(std::io::Error::other)?;
    let handler = MeshcoreHandler::new(config.clone(), scx.clone())
        .with_integrations(target.clone(), meshcore_io.clone());
    let _registration = handler.register().await;

    let listener = Builder::new()
        .name(format!("{}/ws", config.broker_name))
        .laddr(config.listener)
        .allow_anonymous(false)
        .max_packet_size(config.ws_max_payload_bytes)
        .bind()?
        .ws()?;

    tracing::info!(address = %config.listener, "RMQTT MQTT-over-WebSocket listener starting");
    let result = MqttServer::new(scx).listener(listener).build().run().await;
    if let Some(runtime) = &meshcore_io {
        runtime.stop().await;
    }
    if let Some(bridge) = &target {
        bridge.stop().await;
    }
    result?;
    Ok(())
}
