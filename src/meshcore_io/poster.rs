use super::signing::{SignedRequest, SigningError, SigningIdentity};
use super::types::{MeshcoreIoError, MeshcorePoster, PosterResult, UploadJob};
use crate::config::MeshcoreIoConfig;
use async_trait::async_trait;
use futures_util::StreamExt;
use serde_json::Value;
use std::time::Duration;

const MAX_RESPONSE_BYTES: usize = 64 * 1_024;
const MAX_DIAGNOSTIC_CHARS: usize = 2_000;

pub struct HttpMeshcorePoster {
    config: MeshcoreIoConfig,
    client: reqwest::Client,
    signing: SigningIdentity,
}

impl HttpMeshcorePoster {
    pub fn new(config: MeshcoreIoConfig) -> Result<Self, MeshcoreIoError> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(config.request_timeout_ms))
            .build()
            .map_err(MeshcoreIoError::HttpClient)?;
        let signing = SigningIdentity::new(config.private_key.as_deref())?;
        Ok(Self {
            config,
            client,
            signing,
        })
    }

    pub(super) fn signed_request(&self, job: &UploadJob) -> Result<SignedRequest, SigningError> {
        self.signing.signed_request(job)
    }
}

#[async_trait]
impl MeshcorePoster for HttpMeshcorePoster {
    async fn post(&self, job: &UploadJob) -> PosterResult {
        let request = match self.signed_request(job) {
            Ok(request) => request,
            Err(error) => return PosterResult::PermanentlyRejected(error.to_string()),
        };
        if self.config.dry_run {
            return PosterResult::PermanentlyRejected("dry-run".into());
        }
        let response = match self
            .client
            .post(&self.config.api_url)
            .json(&request)
            .send()
            .await
        {
            Ok(response) => response,
            Err(error) => return PosterResult::Retry(format_error(&error.to_string())),
        };
        let status = response.status();
        if response
            .content_length()
            .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
        {
            return PosterResult::Retry("Meshcore.io response body exceeds 64 KiB".into());
        }
        let mut stream = response.bytes_stream();
        let mut body = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = match chunk {
                Ok(chunk) => chunk,
                Err(error) => return PosterResult::Retry(format_error(&error.to_string())),
            };
            if body.len() + chunk.len() > MAX_RESPONSE_BYTES {
                return PosterResult::Retry("Meshcore.io response body exceeds 64 KiB".into());
            }
            body.extend_from_slice(&chunk);
        }
        classify_response(status, &String::from_utf8_lossy(&body))
    }
}

fn classify_response(status: reqwest::StatusCode, text: &str) -> PosterResult {
    let code = serde_json::from_str::<Value>(text)
        .ok()
        .and_then(|value| value.get("code")?.as_str().map(str::to_owned));
    if code.as_deref() == Some("NODES_INSERTED") {
        return PosterResult::Accepted;
    }
    let terminal_code = code
        .as_deref()
        .is_some_and(|code| code.starts_with("ERR_ADVERT_") || code.starts_with("ERR_COORDS_"));
    let permanent = status.is_success()
        || terminal_code
        || status.is_client_error() && status.as_u16() != 408 && status.as_u16() != 429;
    let response_text = if text.is_empty() {
        format!("HTTP {}", status.as_u16())
    } else {
        text.to_owned()
    };
    if permanent {
        PosterResult::PermanentlyRejected(response_text)
    } else {
        PosterResult::Retry(format!(
            "meshcore.io responded HTTP {}{}",
            status.as_u16(),
            diagnostic(&response_text)
                .is_empty()
                .then(String::new)
                .unwrap_or_else(|| format!(": {}", diagnostic(&response_text)))
        ))
    }
}

fn diagnostic(value: &str) -> String {
    value
        .replace(['\r', '\n', '\t'], " ")
        .trim()
        .chars()
        .take(MAX_DIAGNOSTIC_CHARS)
        .collect()
}

pub(super) fn format_error(value: &str) -> String {
    let value: String = value
        .replace(['\r', '\n', '\t'], " ")
        .trim()
        .chars()
        .take(500)
        .collect();
    if value.is_empty() {
        "okänt fel".into()
    } else {
        value
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::meshcore_io::RadioParams;
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};
    use sha2::{Digest, Sha256};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn config() -> MeshcoreIoConfig {
        MeshcoreIoConfig {
            enabled: true,
            api_url: "https://example.invalid".into(),
            private_key: Some(hex::encode([9_u8; 32])),
            request_timeout_ms: 1_000,
            ..Default::default()
        }
    }

    fn job() -> UploadJob {
        UploadJob {
            request_id: "request".into(),
            retries_allowed: 1,
            advert_key: "advert".into(),
            advert_timestamp: 100,
            advert_type: "REPEATER".into(),
            node_name: "Node".into(),
            node_public_key: "a".repeat(64),
            raw_packet_hex: "00".into(),
            observer_id: "b".repeat(64),
            observer_name: None,
            latitude: None,
            longitude: None,
            radio_params: RadioParams {
                freq: Some(869.525),
                cr: Some(5.0),
                sf: Some(11.0),
                bw: Some(125.0),
            },
            enqueued_at: 0,
        }
    }

    #[test]
    fn response_is_classified_once_into_queue_semantics() {
        assert_eq!(
            classify_response(reqwest::StatusCode::OK, r#"{"code":"NODES_INSERTED"}"#),
            PosterResult::Accepted
        );
        assert!(matches!(
            classify_response(reqwest::StatusCode::BAD_REQUEST, "{}"),
            PosterResult::PermanentlyRejected(_)
        ));
        for status in [
            reqwest::StatusCode::REQUEST_TIMEOUT,
            reqwest::StatusCode::TOO_MANY_REQUESTS,
            reqwest::StatusCode::INTERNAL_SERVER_ERROR,
            reqwest::StatusCode::SERVICE_UNAVAILABLE,
        ] {
            assert!(matches!(
                classify_response(status, "{}"),
                PosterResult::Retry(_)
            ));
        }
    }

    #[tokio::test]
    async fn http_poster_sends_the_signed_typescript_schema() {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            let mut buffer = [0_u8; 2_048];
            let header_end = loop {
                let read = stream.read(&mut buffer).await.unwrap();
                request.extend_from_slice(&buffer[..read]);
                if let Some(index) = request.windows(4).position(|part| part == b"\r\n\r\n") {
                    break index + 4;
                }
            };
            let headers = String::from_utf8_lossy(&request[..header_end]);
            let length = headers
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.eq_ignore_ascii_case("content-length")
                        .then(|| value.trim().parse::<usize>().unwrap())
                })
                .unwrap();
            while request.len() < header_end + length {
                let read = stream.read(&mut buffer).await.unwrap();
                request.extend_from_slice(&buffer[..read]);
            }
            let body: Value =
                serde_json::from_slice(&request[header_end..header_end + length]).unwrap();
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 25\r\nConnection: close\r\n\r\n{\"code\":\"NODES_INSERTED\"}",
                )
                .await
                .unwrap();
            body
        });
        let mut config = config();
        config.api_url = format!("http://{address}/nodes");
        let poster = HttpMeshcorePoster::new(config).unwrap();
        assert_eq!(poster.post(&job()).await, PosterResult::Accepted);
        let body = server.await.unwrap();
        let object = body.as_object().unwrap();
        assert_eq!(object.len(), 3);
        assert!(object.contains_key("data"));
        assert!(object.contains_key("signature"));
        assert!(object.contains_key("publicKey"));
        let data = object["data"].as_str().unwrap();
        let public_key: [u8; 32] = hex::decode(object["publicKey"].as_str().unwrap())
            .unwrap()
            .try_into()
            .unwrap();
        let signature =
            Signature::from_slice(&hex::decode(object["signature"].as_str().unwrap()).unwrap())
                .unwrap();
        VerifyingKey::from_bytes(&public_key)
            .unwrap()
            .verify(&Sha256::digest(data.as_bytes()), &signature)
            .expect("test server must verify the request signature");
    }

    #[tokio::test]
    async fn real_http_error_matrix_distinguishes_terminal_retry_and_recovery() {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let address = listener.local_addr().unwrap();
        let responses = [
            (400, r#"{"code":"ERR_ADVERT_INVALID"}"#),
            (408, r#"{"code":"TIMEOUT"}"#),
            (429, r#"{"code":"RATE_LIMITED"}"#),
            (500, r#"{"code":"FAILED"}"#),
            (200, r#"{"code":"NODES_INSERTED"}"#),
        ];
        let server = tokio::spawn(async move {
            for (status, body) in responses {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut request = Vec::new();
                let mut buffer = [0_u8; 2_048];
                loop {
                    let read = stream.read(&mut buffer).await.unwrap();
                    request.extend_from_slice(&buffer[..read]);
                    if request.windows(4).any(|part| part == b"\r\n\r\n") {
                        break;
                    }
                }
                let reason = match status {
                    200 => "OK",
                    400 => "Bad Request",
                    408 => "Request Timeout",
                    429 => "Too Many Requests",
                    500 => "Internal Server Error",
                    _ => unreachable!(),
                };
                let response = format!(
                    "HTTP/1.1 {status} {reason}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                stream.write_all(response.as_bytes()).await.unwrap();
            }
        });
        let mut config = config();
        config.api_url = format!("http://{address}/nodes");
        let poster = HttpMeshcorePoster::new(config).unwrap();
        assert!(matches!(
            poster.post(&job()).await,
            PosterResult::PermanentlyRejected(_)
        ));
        for _ in 0..3 {
            assert!(matches!(poster.post(&job()).await, PosterResult::Retry(_)));
        }
        assert_eq!(poster.post(&job()).await, PosterResult::Accepted);
        server.await.unwrap();
    }
}
