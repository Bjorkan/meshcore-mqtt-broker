#!/usr/bin/env python3
"""Dependency-free authenticated MQTT 3.1.1 over WebSocket smoke client."""

import base64
import os
import socket
import struct
import sys


def mqtt_string(value: bytes) -> bytes:
    return struct.pack("!H", len(value)) + value


def remaining_length(value: int) -> bytes:
    encoded = bytearray()
    while True:
        byte = value % 128
        value //= 128
        if value:
            byte |= 0x80
        encoded.append(byte)
        if not value:
            return bytes(encoded)


def mqtt_packet(header: int, body: bytes) -> bytes:
    return bytes([header]) + remaining_length(len(body)) + body


def recv_exact(connection: socket.socket, length: int) -> bytes:
    chunks = bytearray()
    while len(chunks) < length:
        chunk = connection.recv(length - len(chunks))
        if not chunk:
            raise RuntimeError("WebSocket closed unexpectedly")
        chunks.extend(chunk)
    return bytes(chunks)


def send_frame(connection: socket.socket, opcode: int, payload: bytes) -> None:
    mask = os.urandom(4)
    header = bytearray([0x80 | opcode])
    length = len(payload)
    if length < 126:
        header.append(0x80 | length)
    elif length <= 0xFFFF:
        header.append(0x80 | 126)
        header.extend(struct.pack("!H", length))
    else:
        header.append(0x80 | 127)
        header.extend(struct.pack("!Q", length))
    masked = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
    connection.sendall(bytes(header) + mask + masked)


def receive_binary_frame(connection: socket.socket) -> bytes:
    while True:
        first, second = recv_exact(connection, 2)
        opcode = first & 0x0F
        length = second & 0x7F
        if length == 126:
            length = struct.unpack("!H", recv_exact(connection, 2))[0]
        elif length == 127:
            length = struct.unpack("!Q", recv_exact(connection, 8))[0]
        mask = recv_exact(connection, 4) if second & 0x80 else None
        payload = recv_exact(connection, length)
        if mask:
            payload = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
        if opcode == 0x9:
            send_frame(connection, 0xA, payload)
            continue
        if opcode == 0x8:
            raise RuntimeError("broker closed WebSocket before the smoke completed")
        if opcode != 0x2 or not first & 0x80:
            raise RuntimeError(f"unexpected WebSocket frame opcode={opcode} fin={bool(first & 0x80)}")
        return payload


def websocket(connection: socket.socket, host: str, port: int) -> None:
    key = base64.b64encode(os.urandom(16)).decode("ascii")
    request = (
        "GET / HTTP/1.1\r\n"
        f"Host: {host}:{port}\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        "Sec-WebSocket-Version: 13\r\n"
        "Sec-WebSocket-Protocol: mqtt\r\n\r\n"
    )
    connection.sendall(request.encode("ascii"))
    response = bytearray()
    while b"\r\n\r\n" not in response:
        response.extend(connection.recv(4096))
        if len(response) > 16_384:
            raise RuntimeError("oversized WebSocket handshake response")
    header = response.decode("latin-1").lower()
    if not header.startswith("http/1.1 101 ") or "sec-websocket-protocol: mqtt" not in header:
        raise RuntimeError(f"WebSocket MQTT upgrade failed: {header!r}")


def decode_publish(packet: bytes) -> tuple[str, bytes]:
    if packet[0] & 0xF0 != 0x30:
        raise RuntimeError(f"expected MQTT PUBLISH, got {packet.hex()}")
    index = 1
    multiplier = 1
    remaining = 0
    while True:
        byte = packet[index]
        index += 1
        remaining += (byte & 0x7F) * multiplier
        if byte & 0x80 == 0:
            break
        multiplier *= 128
    body = packet[index : index + remaining]
    topic_length = struct.unpack("!H", body[:2])[0]
    return body[2 : 2 + topic_length].decode("utf-8"), body[2 + topic_length :]


def main() -> None:
    host = "127.0.0.1"
    port = int(sys.argv[1])
    username = b"smoke-admin"
    password = b"smoke-password"
    topic = f"meshcore/STO/{'A' * 64}/serial/commands"
    payload = b"container-smoke"

    with socket.create_connection((host, port), timeout=5) as connection:
        connection.settimeout(5)
        websocket(connection, host, port)

        connect_body = b"\x00\x04MQTT\x04\xC2\x00\x1E"
        connect_body += mqtt_string(b"container-smoke")
        connect_body += mqtt_string(username) + mqtt_string(password)
        send_frame(connection, 0x2, mqtt_packet(0x10, connect_body))
        connack = receive_binary_frame(connection)
        if connack != b"\x20\x02\x00\x00":
            raise RuntimeError(f"authenticated MQTT CONNECT failed: {connack.hex()}")

        subscribe_body = b"\x00\x01" + mqtt_string(b"meshcore/#") + b"\x00"
        send_frame(connection, 0x2, mqtt_packet(0x82, subscribe_body))
        suback = receive_binary_frame(connection)
        if suback != b"\x90\x03\x00\x01\x00":
            raise RuntimeError(f"MQTT SUBSCRIBE failed: {suback.hex()}")

        publish_body = mqtt_string(topic.encode("utf-8")) + payload
        send_frame(connection, 0x2, mqtt_packet(0x30, publish_body))
        received_topic, received_payload = decode_publish(receive_binary_frame(connection))
        if (received_topic, received_payload) != (topic, payload):
            raise RuntimeError(
                f"MQTT publish mismatch: {(received_topic, received_payload)!r}"
            )

        send_frame(connection, 0x2, b"\xE0\x00")
        send_frame(connection, 0x8, b"")

    print("smoke: authenticated MQTT CONNECT/SUBSCRIBE/PUBLISH ok")


if __name__ == "__main__":
    main()
