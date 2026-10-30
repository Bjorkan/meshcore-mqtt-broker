use super::StatusState;
use super::proxy::{forwarded_source, proxy_protocol_line};
use super::websocket::{is_websocket_upgrade, proxy_websocket, read_header};
use crate::config::IpNetwork;
use std::io;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;

pub async fn handle_frontend_connection(
    mut client: TcpStream,
    internal_mqtt: SocketAddr,
    status: StatusState,
    ws_max_payload_bytes: usize,
    trusted_proxies: Arc<[IpNetwork]>,
) -> io::Result<()> {
    let transport_peer = client.peer_addr()?;
    let external_local = client.local_addr()?;
    let (header, client_trailing) = read_header(&mut client).await?;
    let request = std::str::from_utf8(&header).unwrap_or_default();
    let request_line = request.lines().next().unwrap_or_default();
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let path = parts.next().unwrap_or_default();

    if path == "/status" {
        if method != "GET" {
            return write_response(
                &mut client,
                "405 Method Not Allowed",
                b"",
                &[("Allow", "GET")],
            )
            .await;
        }
        let body = serde_json::to_vec(&status.body()).map_err(io::Error::other)?;
        return write_response(
            &mut client,
            "200 OK",
            &body,
            &[
                ("Content-Type", "application/json; charset=utf-8"),
                ("Cache-Control", "no-store"),
            ],
        )
        .await;
    }

    if method == "GET" && is_websocket_upgrade(request) {
        let source = forwarded_source(request, transport_peer, &trusted_proxies);
        let mut upstream = TcpStream::connect(internal_mqtt).await?;
        upstream
            .write_all(proxy_protocol_line(source, external_local).as_bytes())
            .await?;
        upstream.write_all(&header).await?;
        let (response, upstream_trailing) = read_header(&mut upstream).await?;
        client.write_all(&response).await?;
        client.write_all(&upstream_trailing).await?;
        return proxy_websocket(client, upstream, client_trailing, ws_max_payload_bytes).await;
    }

    write_response(&mut client, "404 Not Found", b"", &[]).await
}
async fn write_response(
    stream: &mut TcpStream,
    status: &str,
    body: &[u8],
    headers: &[(&str, &str)],
) -> io::Result<()> {
    let mut response = format!(
        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n",
        body.len()
    );
    for (name, value) in headers {
        response.push_str(name);
        response.push_str(": ");
        response.push_str(value);
        response.push_str("\r\n");
    }
    response.push_str("\r\n");
    stream.write_all(response.as_bytes()).await?;
    stream.write_all(body).await?;
    stream.shutdown().await
}
