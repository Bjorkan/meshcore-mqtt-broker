use meshcore_mqtt_broker::config::Config;
use meshcore_mqtt_broker::rmqtt_handler::MeshcoreHandler;
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
    let handler = MeshcoreHandler::new(config.clone(), scx.clone());
    let _registration = handler.register().await;

    let listener = Builder::new()
        .name(format!("{}/ws", config.broker_name))
        .laddr(config.listener)
        .allow_anonymous(false)
        .max_packet_size(config.ws_max_payload_bytes)
        .bind()?
        .ws()?;

    tracing::info!(address = %config.listener, "RMQTT MQTT-over-WebSocket listener starting");
    MqttServer::new(scx)
        .listener(listener)
        .build()
        .run()
        .await?;
    Ok(())
}
