use meshcore_mqtt_broker::config::Config;
use meshcore_mqtt_broker::meshcore_io::MeshcoreIoRuntime;
use meshcore_mqtt_broker::production::{
    StatusState, handle_frontend_connection, run_healthcheck, shutdown_signal,
};
use meshcore_mqtt_broker::retained::{
    NEIGHBOR_RETENTION, RETAINED_NEIGHBOR_CAPACITY, RetainedNeighbors,
};
use meshcore_mqtt_broker::rmqtt_handler::MeshcoreHandler;
use meshcore_mqtt_broker::routing::RoleRouter;
use meshcore_mqtt_broker::target_bridge::TargetBridge;
use rmqtt::context::ServerContext;
use rmqtt::net::Builder;
use rmqtt::server::MqttServer;
use std::future::Future;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::task::JoinSet;
use tracing_subscriber::EnvFilter;

const SHUTDOWN_STEP_TIMEOUT: Duration = Duration::from_secs(5);

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let config = Arc::new(Config::discover()?);
    if std::env::args().nth(1).as_deref() == Some("healthcheck") {
        run_healthcheck(&config.healthcheck)
            .await
            .map_err(std::io::Error::other)?;
        tracing::info!(url = %config.healthcheck.url, "healthcheck ok (stateless)");
        return Ok(());
    }

    run_broker(config).await
}

async fn run_broker(config: Arc<Config>) -> Result<(), Box<dyn std::error::Error>> {
    let frontend = TcpListener::bind(config.listener).await?;
    let internal_addr = reserve_loopback_address()?;
    let instance_id = format!("{}-{}", config.broker_name, uuid::Uuid::new_v4());
    let scx = ServerContext::new().build().await;
    *scx.extends.router_mut().await = Box::new(RoleRouter::new(scx.clone(), config.clone()));

    let retained =
        RetainedNeighbors::new(scx.clone(), RETAINED_NEIGHBOR_CAPACITY, NEIGHBOR_RETENTION);
    retained.install().await;
    let retained_expiry = retained.spawn_expiry();
    let target = TargetBridge::start(config.target_mqtt.clone(), instance_id.clone())
        .map_err(std::io::Error::other)?;
    let meshcore_io = match MeshcoreIoRuntime::start(config.meshcore_io.clone()) {
        Ok(runtime) => runtime,
        Err(error) => {
            if let Some(target) = &target {
                target.stop().await;
            }
            return Err(std::io::Error::other(error).into());
        }
    };
    let handler = MeshcoreHandler::new(config.clone(), scx.clone())
        .with_integrations(target.clone(), meshcore_io.clone());
    let registration = handler.register().await;
    let status = StatusState::new(
        instance_id.clone(),
        handler,
        target.clone(),
        meshcore_io.clone(),
        config.meshcore_io.enabled,
    );

    let listener = Builder::new()
        .name(format!("{}/ws-internal", config.broker_name))
        .laddr(internal_addr)
        .allow_anonymous(false)
        .max_packet_size(config.ws_max_payload_bytes)
        .bind()?
        .ws()?;
    let server = MqttServer::new(scx.clone()).listener(listener).build();
    let mut mqtt_task = tokio::spawn(server.run());
    let mut connections = JoinSet::new();
    let shutdown = shutdown_signal();
    tokio::pin!(shutdown);

    tracing::info!(
        address = %config.listener,
        instance_id,
        "RMQTT MQTT-over-WebSocket and HTTP status listener starting"
    );
    let mut run_error = None;
    let mut mqtt_task_completed = false;
    loop {
        tokio::select! {
            signal = &mut shutdown => {
                if let Err(error) = signal {
                    run_error = Some(std::io::Error::other(error));
                } else {
                    tracing::info!("shutdown signal received");
                }
                break;
            }
            result = &mut mqtt_task => {
                mqtt_task_completed = true;
                run_error = Some(match result {
                    Ok(Ok(())) => std::io::Error::other("RMQTT listener stopped unexpectedly"),
                    Ok(Err(error)) => std::io::Error::other(error),
                    Err(error) => std::io::Error::other(error),
                });
                break;
            }
            accepted = frontend.accept() => {
                match accepted {
                    Ok((stream, _)) => {
                        let status = status.clone();
                        connections.spawn(async move {
                            if let Err(error) = handle_frontend_connection(stream, internal_addr, status).await {
                                tracing::debug!(%error, "frontend connection closed");
                            }
                        });
                    }
                    Err(error) => {
                        run_error = Some(error);
                        break;
                    }
                }
            }
            Some(result) = connections.join_next(), if !connections.is_empty() => {
                if let Err(error) = result {
                    tracing::debug!(%error, "frontend task ended");
                }
            }
        }
    }

    tracing::info!("shutdown: stopping listener and MQTT sessions");
    drop(frontend);
    registration.stop().await;
    if !mqtt_task_completed {
        mqtt_task.abort();
        let _ = mqtt_task.await;
    }
    timed_shutdown("MQTT sessions", disconnect_sessions(&scx)).await;
    connections.shutdown().await;
    retained_expiry.abort();
    if let Some(runtime) = &meshcore_io {
        timed_shutdown("MeshCore.io", runtime.stop()).await;
    }
    if let Some(bridge) = &target {
        timed_shutdown("target MQTT", bridge.stop()).await;
    }
    tracing::info!("shutdown: broker stopped");

    if let Some(error) = run_error {
        Err(error.into())
    } else {
        Ok(())
    }
}

fn reserve_loopback_address() -> std::io::Result<SocketAddr> {
    let reservation = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    let port = reservation.local_addr()?.port();
    drop(reservation);
    Ok(SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port))
}

async fn disconnect_sessions(scx: &ServerContext) {
    let shared = scx.extends.shared().await;
    for mut entry in shared.iter() {
        if let Err(error) = entry.kick(true, true, false).await {
            tracing::warn!(client = %entry.id(), %error, "shutdown: could not close MQTT session");
        }
    }
}

async fn timed_shutdown(label: &str, operation: impl Future<Output = ()>) {
    if tokio::time::timeout(SHUTDOWN_STEP_TIMEOUT, operation)
        .await
        .is_err()
    {
        tracing::warn!(label, "shutdown step timed out; continuing");
    }
}
