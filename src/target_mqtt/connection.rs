use super::tracker::WriteTracker;
use super::{TargetError, TargetSink};
use crate::config::TargetMqttConfig;
use async_trait::async_trait;
use bytes::Bytes;
use rumqttc::{
    AsyncClient, Event, Incoming, MqttOptions, Outgoing, QoS, TlsConfiguration, Transport,
};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

const TARGET_MAX_PENDING: usize = 1_000;

pub(super) struct RumqttTarget {
    client: AsyncClient,
    connected: Arc<AtomicBool>,
    next_write_id: AtomicU64,
    writes: Arc<StdMutex<WriteTracker>>,
    submit: Mutex<()>,
    task: Mutex<Option<JoinHandle<()>>>,
}

impl RumqttTarget {
    pub(super) fn connect(
        config: &TargetMqttConfig,
        client_id: &str,
    ) -> Result<Arc<Self>, TargetError> {
        let url = url::Url::parse(&config.url)
            .map_err(|error| TargetError::Configuration(error.to_string()))?;
        let host = url
            .host_str()
            .ok_or_else(|| TargetError::Configuration("MQTT URL has no host".into()))?;
        let secure = url.scheme() == "mqtts";
        let port = url.port().unwrap_or(if secure { 8_883 } else { 1_883 });
        let mut options = MqttOptions::new(client_id, host, port);
        options.set_clean_session(true);
        options.set_request_channel_capacity(TARGET_MAX_PENDING);
        options.set_keep_alive(Duration::from_secs(30));
        if secure {
            options.set_transport(Transport::tls_with_config(TlsConfiguration::Native));
        }
        let url_username = percent_decode(url.username());
        let url_password = url.password().map(percent_decode).unwrap_or_default();
        let username = if config.username.is_empty() {
            url_username
        } else {
            config.username.clone()
        };
        let password = if config.password.is_empty() {
            url_password
        } else {
            config.password.clone()
        };
        if !username.is_empty() || !password.is_empty() {
            options.set_credentials(username, password);
        }
        let (client, mut eventloop) = AsyncClient::new(options, TARGET_MAX_PENDING);
        eventloop
            .network_options
            .set_connection_timeout(config.connect_timeout_ms.div_ceil(1_000));
        let connected = Arc::new(AtomicBool::new(false));
        let connected_for_task = connected.clone();
        let writes: Arc<StdMutex<WriteTracker>> = Arc::new(StdMutex::new(WriteTracker::new()));
        let writes_for_task = writes.clone();
        let reconnect = Duration::from_millis(config.reconnect_period_ms);
        let task = tokio::spawn(async move {
            loop {
                match eventloop.poll().await {
                    Ok(Event::Incoming(Incoming::ConnAck(_))) => {
                        connected_for_task.store(true, Ordering::Release);
                        tracing::info!("connected to target MQTT broker");
                    }
                    Ok(Event::Outgoing(Outgoing::Publish(_))) => {
                        // FIFO: channel submission order equals event order,
                        // so the front entry belongs to this exact publish.
                        if let Some((_, complete)) = writes_for_task.lock().unwrap().pop_front() {
                            let _ = complete.send(Ok(()));
                        }
                    }
                    Ok(_) => {}
                    Err(error) => {
                        connected_for_task.store(false, Ordering::Release);
                        let error = TargetError::Publish(error.to_string());
                        for (_, complete) in writes_for_task.lock().unwrap().drain() {
                            let _ = complete.send(Err(error.clone()));
                        }
                        tracing::warn!(%error, "target MQTT connection unavailable");
                        if reconnect.is_zero() {
                            break;
                        }
                        tokio::time::sleep(reconnect).await;
                    }
                }
            }
        });
        Ok(Arc::new(Self {
            client,
            connected,
            next_write_id: AtomicU64::new(0),
            writes,
            submit: Mutex::new(()),
            task: Mutex::new(Some(task)),
        }))
    }
}

#[async_trait]
impl TargetSink for RumqttTarget {
    fn connected(&self) -> bool {
        self.connected.load(Ordering::Acquire)
    }

    async fn publish(&self, topic: &str, payload: Bytes, retain: bool) -> Result<(), TargetError> {
        let id = self.next_write_id.fetch_add(1, Ordering::Relaxed);
        let (complete, completed) = tokio::sync::oneshot::channel();
        // Serialize submission + association: the callback is registered and
        // the publish is sent to the channel while no other submission is in
        // flight, so the eventloop's FIFO pop_front always completes the
        // callback registered for this exact publish.
        let _submit = self.submit.lock().await;
        self.writes.lock().unwrap().submit(id, complete);
        if let Err(error) = self
            .client
            .publish(topic, QoS::AtMostOnce, retain, payload)
            .await
        {
            // The request never entered the channel, so no Outgoing event
            // will arrive for it: remove only this submission.
            self.writes.lock().unwrap().remove(id);
            return Err(TargetError::Publish(error.to_string()));
        }
        drop(_submit);
        // Cancellation-safe by design: if the caller abandons this future
        // (publish timeout), the tracker entry stays and is consumed by its
        // own Outgoing event, whose send then fails on the dropped receiver.
        // Entries are only ever removed when the request never entered the
        // channel, so a later event can never consume a wrong callback.
        completed.await.map_err(|_| TargetError::CallbackStopped)?
    }

    async fn stop(&self) {
        self.connected.store(false, Ordering::Release);
        for (_, complete) in self.writes.lock().unwrap().drain() {
            let _ = complete.send(Err(TargetError::Stopping));
        }
        let _ = self.client.disconnect().await;
        let task = self.task.lock().await.take();
        if let Some(task) = task {
            task.abort();
            let _ = task.await;
        }
    }
}

pub(super) fn percent_decode(value: &str) -> String {
    percent_encoding::percent_decode_str(value)
        .decode_utf8_lossy()
        .into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn target_url_credentials_use_url_percent_decoding_not_form_decoding() {
        assert_eq!(percent_decode("literal+plus"), "literal+plus");
        assert_eq!(percent_decode("encoded%2Bplus"), "encoded+plus");
        assert_eq!(percent_decode("space%20value"), "space value");
        assert_eq!(percent_decode("r%C3%A4ksm%C3%B6rg%C3%A5s"), "räksmörgås");
    }
}
