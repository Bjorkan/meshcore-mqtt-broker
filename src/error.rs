use serde::Serialize;
use std::fmt;
use std::time::{SystemTime, UNIX_EPOCH};

pub const OBSERVER_ERROR_PAYLOAD_MAX_BYTES: usize = 768;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ObserverErrorCode {
    AuthInvalidUsernameFormat,
    AuthInvalidPublicKey,
    AuthMissingToken,
    AuthInvalidToken,
    AuthInvalidPassword,
    AuthWrongAudience,
    AuthStaleToken,
    AuthShuttingDown,
    AuthInternalError,
    SubscriberConnectionLimit,
    PublishNotMeshcoreTopic,
    PublishBadTopicShape,
    PublishPlaceholderIata,
    PublishTestIngressDisabled,
    PublishInvalidIataFormat,
    PublishSecondaryIata,
    PublishUnknownIata,
    PublishKeyMismatch,
    PublishStaleConnection,
    PublishStaleStatus,
    PublishReservedSubtopic,
    PublishSerialResponseInvalid,
    PublishPayloadTooLarge,
    PublishInvalidJson,
    PublishOriginMissing,
    PublishOriginMismatch,
    PublishUnknownClient,
    PublishInternalError,
}

impl fmt::Display for ObserverErrorCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let json = serde_json::to_string(self).expect("error codes serialize");
        f.write_str(json.trim_matches('"'))
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ObserverError {
    pub code: ObserverErrorCode,
    pub message: String,
    pub topic: Option<String>,
    pub iata: Option<String>,
    pub close: bool,
}

impl ObserverError {
    pub fn new(code: ObserverErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            topic: None,
            iata: None,
            close: false,
        }
    }

    pub fn topic(mut self, topic: impl Into<String>) -> Self {
        self.topic = Some(topic.into());
        self
    }

    pub fn iata(mut self, iata: impl Into<String>) -> Self {
        self.iata = Some(iata.into());
        self
    }

    pub fn close(mut self) -> Self {
        self.close = true;
        self
    }

    pub fn reason(&self) -> String {
        format!("[{}] {}", self.code, self.message)
    }

    pub fn notification(&self) -> Vec<u8> {
        #[derive(Serialize)]
        struct Payload<'a> {
            code: ObserverErrorCode,
            message: &'a str,
            #[serde(skip_serializing_if = "Option::is_none")]
            topic: Option<&'a str>,
            #[serde(skip_serializing_if = "Option::is_none")]
            iata: Option<&'a str>,
            at: String,
        }

        let at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
            .to_string();
        let mut message = self.message.clone();
        let mut topic = self.topic.clone();
        let mut iata = self.iata.clone();
        loop {
            let value = Payload {
                code: self.code,
                message: &message,
                topic: topic.as_deref(),
                iata: iata.as_deref(),
                at: at.clone(),
            };
            let encoded = serde_json::to_vec(&value).expect("notification serializes");
            if encoded.len() <= OBSERVER_ERROR_PAYLOAD_MAX_BYTES {
                return encoded;
            }
            if shrink(&mut topic) || shrink(&mut iata) || shrink_required(&mut message) {
                continue;
            }
            return format!(
                r#"{{"code":"{}","message":"Observer request denied.","at":"{}"}}"#,
                self.code, at
            )
            .into_bytes();
        }
    }
}

fn shrink(value: &mut Option<String>) -> bool {
    let Some(text) = value else { return false };
    if text.chars().count() <= 8 {
        *value = None;
    } else {
        let keep = text.chars().count() / 2;
        *text = format!("{}...", text.chars().take(keep).collect::<String>());
    }
    true
}

fn shrink_required(value: &mut String) -> bool {
    if value.chars().count() <= 32 {
        return false;
    }
    let keep = value.chars().count() / 2;
    *value = format!("{}...", value.chars().take(keep).collect::<String>());
    true
}

impl fmt::Display for ObserverError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.reason())
    }
}

impl std::error::Error for ObserverError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notification_is_bounded_valid_json_and_keeps_code() {
        let err = ObserverError::new(ObserverErrorCode::PublishUnknownIata, "å".repeat(2_000))
            .topic("x".repeat(2_000))
            .iata("ABC");
        let bytes = err.notification();
        assert!(bytes.len() <= OBSERVER_ERROR_PAYLOAD_MAX_BYTES);
        let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(value["code"], "PUBLISH_UNKNOWN_IATA");
    }
}
