use super::topics::{is_private_meshcore_topic, parse_meshcore_topic};
use super::{denied, denied_iata};
use crate::auth::Principal;
use crate::config::{Config, SubscriberRole};
use crate::error::{ObserverError, ObserverErrorCode as Code};

pub fn authorize_subscribe(
    config: &Config,
    principal: &Principal,
    owns_observer: bool,
    topic: &str,
) -> Result<(), ObserverError> {
    match principal {
        Principal::Publisher { public_key } => {
            authorize_observer_subscribe(config, public_key, owns_observer, topic)
        }
        Principal::Subscriber {
            role: SubscriberRole::Admin,
            ..
        } => Ok(()),
        Principal::Subscriber { .. } => {
            let public = topic == "meshcore/#"
                || topic.starts_with("meshcore/") && !is_private_meshcore_topic(topic);
            if (public || topic == "heartbeat/") && !topic.starts_with("$SYS/") {
                Ok(())
            } else {
                Err(denied(
                    Code::PublishReservedSubtopic,
                    "Only public meshcore topics and heartbeat are available for this role.",
                    topic,
                ))
            }
        }
    }
}

fn authorize_observer_subscribe(
    config: &Config,
    public_key: &str,
    owns_observer: bool,
    topic: &str,
) -> Result<(), ObserverError> {
    if !owns_observer {
        return Err(denied(
            Code::PublishStaleConnection,
            "Publisher is not the active observer connection. Reconnect to take over.",
            topic,
        ));
    }
    let stripped = topic
        .strip_suffix("/#")
        .or_else(|| topic.strip_suffix("/+"))
        .unwrap_or(topic);
    let parsed = parse_meshcore_topic(stripped).ok_or_else(|| {
        denied(
            Code::PublishReservedSubtopic,
            "Observers can only subscribe to their own error and serial/commands topics.",
            topic,
        )
        .close()
    })?;
    if parsed.public_key != public_key.to_ascii_uppercase() {
        return Err(denied(
            Code::PublishReservedSubtopic,
            "Observers can only subscribe to their own topics.",
            topic,
        )
        .close());
    }
    let subtopic = parsed.subtopic.to_ascii_lowercase();
    if subtopic == "error" || subtopic.starts_with("error/") {
        return Ok(());
    }
    if subtopic == "serial/commands" {
        return if parsed.iata == "test" && config.allow_test_ingress
            || config.allowed_iata.contains(&parsed.iata)
        {
            Ok(())
        } else {
            Err(denied_iata(
                Code::PublishUnknownIata,
                "serial/commands requires an allowed observer IATA; fix the observer IATA to receive commands.",
                topic,
                &parsed.iata,
            ))
        };
    }
    Err(denied(
        Code::PublishReservedSubtopic,
        "Publisher clients are publish-only; observers can only subscribe to their own error and serial/commands topics.",
        topic,
    )
    .close())
}
