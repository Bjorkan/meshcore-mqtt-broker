use std::io;
use std::pin::Pin;
use std::task::{Context, Poll};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;

const MAX_HTTP_HEADER_BYTES: usize = 16 * 1_024;
const HTTP_HEADER_TIMEOUT: Duration = Duration::from_secs(10);

pub(super) async fn read_header(stream: &mut TcpStream) -> io::Result<(Vec<u8>, Vec<u8>)> {
    tokio::time::timeout(HTTP_HEADER_TIMEOUT, async {
        let mut header = Vec::with_capacity(1_024);
        loop {
            if header.len() >= MAX_HTTP_HEADER_BYTES {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "HTTP request header exceeds 16 KiB",
                ));
            }
            let mut chunk = [0_u8; 1_024];
            let read = stream.read(&mut chunk).await?;
            if read == 0 {
                return Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "connection closed before HTTP headers",
                ));
            }
            header.extend_from_slice(&chunk[..read]);
            if header.len() > MAX_HTTP_HEADER_BYTES {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "HTTP request header exceeds 16 KiB",
                ));
            }
            if let Some(index) = header.windows(4).position(|window| window == b"\r\n\r\n") {
                let trailing = header.split_off(index + 4);
                return Ok((header, trailing));
            }
        }
    })
    .await
    .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "HTTP header timed out"))?
}

pub(super) async fn proxy_websocket(
    mut client: TcpStream,
    mut upstream: TcpStream,
    client_trailing: Vec<u8>,
    max_message_size: usize,
) -> io::Result<()> {
    let (mut client_read, mut client_write) = client.split();
    let (mut upstream_read, mut upstream_write) = upstream.split();
    let mut client_read = PrefixedReader::new(client_trailing, &mut client_read);
    tokio::select! {
        result = copy_websocket_frames_limited(
            &mut client_read,
            &mut upstream_write,
            max_message_size,
        ) => result.map(|_| ()),
        result = tokio::io::copy(&mut upstream_read, &mut client_write) => result.map(|_| ()),
    }
}

struct PrefixedReader<R> {
    prefix: Vec<u8>,
    offset: usize,
    inner: R,
}

impl<R> PrefixedReader<R> {
    fn new(prefix: Vec<u8>, inner: R) -> Self {
        Self {
            prefix,
            offset: 0,
            inner,
        }
    }
}

impl<R: AsyncRead + Unpin> AsyncRead for PrefixedReader<R> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buffer: &mut tokio::io::ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        if self.offset < self.prefix.len() {
            let take = buffer.remaining().min(self.prefix.len() - self.offset);
            buffer.put_slice(&self.prefix[self.offset..self.offset + take]);
            self.offset += take;
            return Poll::Ready(Ok(()));
        }
        Pin::new(&mut self.inner).poll_read(context, buffer)
    }
}

/// Copies client-to-broker WebSocket frames while enforcing a limit on the
/// complete data message. Control frames do not count, and continuation
/// frames share the size budget of the message they extend.
async fn copy_websocket_frames_limited<R, W>(
    reader: &mut R,
    writer: &mut W,
    max_message_size: usize,
) -> io::Result<u64>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let mut copied = 0_u64;
    let mut fragmented_size = None::<usize>;
    loop {
        let first = match reader.read_u8().await {
            Ok(value) => value,
            Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => return Ok(copied),
            Err(error) => return Err(error),
        };
        let second = reader.read_u8().await?;
        let fin = first & 0x80 != 0;
        let opcode = first & 0x0f;
        let masked = second & 0x80 != 0;
        let marker = second & 0x7f;
        let mut frame_header = vec![first, second];
        let payload_len = match marker {
            126 => {
                let mut bytes = [0_u8; 2];
                reader.read_exact(&mut bytes).await?;
                frame_header.extend_from_slice(&bytes);
                u16::from_be_bytes(bytes) as u64
            }
            127 => {
                let mut bytes = [0_u8; 8];
                reader.read_exact(&mut bytes).await?;
                frame_header.extend_from_slice(&bytes);
                u64::from_be_bytes(bytes)
            }
            value => u64::from(value),
        };
        let payload_len = usize::try_from(payload_len)
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "WebSocket frame too large"))?;

        match opcode {
            0x0 => {
                let Some(size) = fragmented_size else {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "WebSocket continuation without an open message",
                    ));
                };
                let size = size.checked_add(payload_len).ok_or_else(|| {
                    io::Error::new(io::ErrorKind::InvalidData, "WebSocket message too large")
                })?;
                if size > max_message_size {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "WebSocket message exceeds configured payload limit",
                    ));
                }
                fragmented_size = (!fin).then_some(size);
            }
            0x1 | 0x2 => {
                if fragmented_size.is_some() {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "new WebSocket data frame during fragmented message",
                    ));
                }
                if payload_len > max_message_size {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "WebSocket message exceeds configured payload limit",
                    ));
                }
                fragmented_size = (!fin).then_some(payload_len);
            }
            0x8..=0xf if fin && payload_len <= 125 => {}
            _ => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "invalid WebSocket opcode or fragmented control frame",
                ));
            }
        }

        if masked {
            let mut mask = [0_u8; 4];
            reader.read_exact(&mut mask).await?;
            frame_header.extend_from_slice(&mask);
        }
        writer.write_all(&frame_header).await?;
        copied += frame_header.len() as u64;

        let mut remaining = payload_len;
        let mut buffer = [0_u8; 8 * 1_024];
        while remaining > 0 {
            let take = remaining.min(buffer.len());
            reader.read_exact(&mut buffer[..take]).await?;
            writer.write_all(&buffer[..take]).await?;
            copied += take as u64;
            remaining -= take;
        }
        writer.flush().await?;
    }
}

pub(super) fn is_websocket_upgrade(request: &str) -> bool {
    request.lines().skip(1).any(|line| {
        line.split_once(':').is_some_and(|(name, value)| {
            name.eq_ignore_ascii_case("upgrade") && value.trim().eq_ignore_ascii_case("websocket")
        })
    })
}
