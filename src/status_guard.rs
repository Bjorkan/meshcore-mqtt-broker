use crate::error::{ObserverError, ObserverErrorCode as Code};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Mirrors the legacy stale-status guard: a status message whose device
/// timestamp is older than the newest accepted one for the same public key
/// is rejected with `PUBLISH_STALE_STATUS`. Equal timestamps are accepted
/// (two observers may legitimately re-send the same device timestamp).
/// Missing or unparseable timestamps skip the guard entirely.
pub const STALE_STATUS_GUARD_TTL_MS: u64 = 48 * 60 * 60 * 1_000;
const MAX_OBSERVED_OBSERVERS: usize = 50_000;
const SWEEP_INTERVAL_MS: u64 = 60 * 1_000;

#[derive(Clone, Default)]
pub struct StatusGuard {
    state: Arc<Mutex<State>>,
}

#[derive(Default)]
struct State {
    latest: HashMap<String, StatusRecord>,
    last_sweep_at: u64,
}

struct StatusRecord {
    device_timestamp: i64,
    received_at_ms: u64,
}

impl StatusGuard {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn accept_status(&self, public_key: &str, payload: &[u8]) -> Result<(), ObserverError> {
        self.accept_status_at(public_key, payload, now_ms())
    }

    fn accept_status_at(
        &self,
        public_key: &str,
        payload: &[u8],
        now: u64,
    ) -> Result<(), ObserverError> {
        let Some(timestamp) = device_timestamp(payload) else {
            return Ok(());
        };
        let key = public_key.to_ascii_uppercase();
        let mut state = self.state.lock().expect("status guard lock");
        // Sweep amortized over the legacy hourly cadence: entry age is
        // measured from broker receipt time, never the device timestamp,
        // so a slow device clock cannot expire the record early.
        if now.saturating_sub(state.last_sweep_at) >= SWEEP_INTERVAL_MS {
            state.latest.retain(|_, record| {
                record
                    .received_at_ms
                    .saturating_add(STALE_STATUS_GUARD_TTL_MS)
                    > now
            });
            state.last_sweep_at = now;
        }
        if state
            .latest
            .get(&key)
            .is_some_and(|record| timestamp < record.device_timestamp)
        {
            return Err(ObserverError::new(
                Code::PublishStaleStatus,
                "Stale status message discarded: device timestamp is older than the latest accepted status. Check the observer clock.",
            ));
        }
        state.latest.insert(
            key,
            StatusRecord {
                device_timestamp: timestamp,
                received_at_ms: now,
            },
        );
        while state.latest.len() > MAX_OBSERVED_OBSERVERS {
            let Some(oldest) = state.latest.keys().next().cloned() else {
                break;
            };
            state.latest.remove(&oldest);
        }
        Ok(())
    }
}

/// Extract a device timestamp the same way the legacy broker did:
/// JSON numbers are epoch milliseconds, strings are ISO-8601 dates
/// (`new Date(raw).getTime()`). Invalid or non-positive values skip the
/// guard and are accepted without being recorded.
fn device_timestamp(payload: &[u8]) -> Option<i64> {
    let value: Value = serde_json::from_slice(payload).ok()?;
    let raw = value.get("timestamp")?;
    let timestamp = match raw {
        Value::Number(number) => number
            .as_i64()
            .or_else(|| number.as_f64().map(|value| value as i64))?,
        Value::String(text) => parse_timestamp(text.trim())?,
        _ => return None,
    };
    (timestamp > 0).then_some(timestamp)
}

fn parse_timestamp(text: &str) -> Option<i64> {
    if let Ok(millis) = text.parse::<i64>() {
        return Some(millis);
    }
    chrono::DateTime::parse_from_rfc3339(text)
        .ok()
        .map(|value| value.timestamp_millis())
        .or_else(|| {
            chrono::DateTime::parse_from_rfc2822(text)
                .ok()
                .map(|value| value.timestamp_millis())
        })
        .or_else(|| {
            // JavaScript Date accepts ISO-like datetimes without an offset.
            // Broker deployments run in UTC; make that policy explicit so
            // behavior cannot depend on the host's local timezone.
            ["%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%d %H:%M:%S%.f"]
                .into_iter()
                .find_map(|format| chrono::NaiveDateTime::parse_from_str(text, format).ok())
                .map(|value| value.and_utc().timestamp_millis())
        })
        .or_else(|| {
            chrono::NaiveDate::parse_from_str(text, "%Y-%m-%d")
                .ok()
                .map(|date| {
                    date.and_hms_opt(0, 0, 0)
                        .unwrap()
                        .and_utc()
                        .timestamp_millis()
                })
        })
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = "4852B69364572B52EFA1B6BB3E6D0ABED4F389A1CBFBB60A9BBA2CCE649CAF0E";

    fn status(timestamp: impl Into<Value>) -> Vec<u8> {
        format!(
            r#"{{"origin_id":"{KEY}","timestamp":{}}}"#,
            timestamp.into()
        )
        .into_bytes()
    }

    #[test]
    fn newer_equal_and_older_timestamps_follow_the_legacy_policy() {
        let guard = StatusGuard::new();
        assert!(
            guard
                .accept_status_at(KEY, &status(Value::from("2026-01-02T00:00:00.000Z")), 1_000)
                .is_ok()
        );
        // Equal timestamps are accepted: observers may re-send the same one.
        assert!(
            guard
                .accept_status_at(KEY, &status(Value::from("2026-01-02T00:00:00.000Z")), 2_000)
                .is_ok()
        );
        // Older device timestamp -> PUBLISH_STALE_STATUS.
        assert_eq!(
            guard
                .accept_status_at(KEY, &status(Value::from("2026-01-01T00:00:00.000Z")), 3_000)
                .unwrap_err()
                .code,
            Code::PublishStaleStatus
        );
        // Newer timestamps recover acceptance, in epoch-ms form too.
        assert!(
            guard
                .accept_status_at(KEY, &status(Value::from(1_800_000_000_000_i64)), 4_000)
                .is_ok()
        );
    }

    #[test]
    fn missing_null_zero_and_unparseable_timestamps_skip_the_guard() {
        let guard = StatusGuard::new();
        for payload in [
            format!(r#"{{"origin_id":"{KEY}"}}"#).into_bytes(),
            format!(r#"{{"origin_id":"{KEY}","timestamp":null}}"#).into_bytes(),
            format!(r#"{{"origin_id":"{KEY}","timestamp":0}}"#).into_bytes(),
            format!(r#"{{"origin_id":"{KEY}","timestamp":"not a date"}}"#).into_bytes(),
            format!(r#"{{"origin_id":"{KEY}","timestamp":false}}"#).into_bytes(),
            b"not json".to_vec(),
        ] {
            assert!(guard.accept_status_at(KEY, &payload, 1_000).is_ok());
        }
        // None of the skipped messages recorded a device timestamp, so even
        // an ancient timestamp is still accepted afterwards.
        assert!(
            guard
                .accept_status_at(KEY, &status(Value::from("1970-01-01T00:00:00Z")), 2_000)
                .is_ok()
        );
    }

    #[test]
    fn guard_state_is_keyed_per_public_key_and_expires_by_receipt_time() {
        let other = "0000000000000000000000000000000000000000000000000000000000000000";
        let guard = StatusGuard::new();
        assert!(
            guard
                .accept_status_at(KEY, &status(Value::from("2026-01-02T00:00:00.000Z")), 1_000)
                .is_ok()
        );
        // A different public key keeps its own independent history.
        assert!(
            guard
                .accept_status_at(
                    other,
                    &status(Value::from("2026-01-01T00:00:00.000Z")),
                    2_000
                )
                .is_ok()
        );
        // Sweep after the guard TTL expires the KEY record: an older
        // timestamp is accepted again once the record is gone.
        let later = 1_000 + STALE_STATUS_GUARD_TTL_MS + 10_000;
        assert!(
            guard
                .accept_status_at(KEY, &status(Value::from("2026-01-01T00:00:00.000Z")), later)
                .is_ok()
        );
    }

    #[test]
    fn timestamp_strings_cover_javascript_date_formats_used_by_observers() {
        let expected = chrono::DateTime::parse_from_rfc3339("2026-01-02T03:04:05Z")
            .unwrap()
            .timestamp_millis();
        for value in [
            "2026-01-02T03:04:05Z",
            "2026-01-02T03:04:05+00:00",
            "2026-01-02T03:04:05",
            "2026-01-02 03:04:05",
            "Fri, 02 Jan 2026 03:04:05 GMT",
        ] {
            assert_eq!(parse_timestamp(value), Some(expected), "{value}");
        }
        assert_eq!(
            parse_timestamp("2026-01-02"),
            Some(
                chrono::DateTime::parse_from_rfc3339("2026-01-02T00:00:00Z")
                    .unwrap()
                    .timestamp_millis()
            )
        );
    }
}
