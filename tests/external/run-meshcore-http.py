#!/usr/bin/env python3
"""Exercise a built broker image against a signature-verifying HTTP server.

Linux host networking, Python cryptography, Docker, and the built Paho probe
are required. All keys, accounts, adverts and broker state are synthetic.
"""

import argparse
import hashlib
import http.server
import json
import pathlib
import socket
import subprocess
import tempfile
import threading
import time
import urllib.request
import uuid

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey


def docker(*args):
    return subprocess.check_output(["docker", *args], text=True).strip()


def wait_for(check, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if check():
            return
        time.sleep(0.05)
    raise AssertionError("timed out waiting for expected broker state")


def run_case(image, client, responses):
    lock = threading.Lock()
    received = []
    failures = []
    release = threading.Event()

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_POST(self):
            try:
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                assert set(body) == {"data", "signature", "publicKey"}
                Ed25519PublicKey.from_public_bytes(bytes.fromhex(body["publicKey"])).verify(
                    bytes.fromhex(body["signature"]), hashlib.sha256(body["data"].encode()).digest()
                )
                data = json.loads(body["data"])
                assert data["links"][0].startswith("meshcore://")
                assert data["params"] == {"freq": 869.525, "bw": 125.0, "sf": 11.0, "cr": 5.0}
                with lock:
                    index = len(received)
                    received.append(body)
                response = responses[min(index, len(responses) - 1)]
                if response == "shutdown":
                    release.wait(15)
                    return
                if response == "timeout":
                    release.wait(2)
                    response = 200
                payload = json.dumps({"code": "NODES_INSERTED" if response == 200 else "SYNTHETIC_FAILURE"}).encode()
                self.send_response(response)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
            except (BrokenPipeError, ConnectionResetError):
                pass  # timeout/shutdown deliberately closes the request
            except Exception as error:
                with lock:
                    failures.append(str(error))

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever)
    thread.start()
    container = "meshcore-issue273-http-" + uuid.uuid4().hex[:12]
    # Select an unused host listener for this short-lived isolated broker.
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    try:
        with tempfile.TemporaryDirectory(prefix="meshcore-http-") as work:
            config = {
                "mqtt": {"host": "127.0.0.1", "ws_port": port},
                "broker": {"name": container},
                "auth": {"expected_audience": "integration"},
                "subscribers": {"default_max_connections": 2, "users": []},
                "iata": {"allowlist_enabled": True},
                "allowed_iata": ["STO"],
                "target_mqtt": {"url": ""},
                "meshcore_io": {
                    "enabled": True,
                    "api_url": f"http://127.0.0.1:{server.server_port}/nodes",
                    "request_timeout_ms": 1000,
                    "retry_delay_ms": 50,
                    "attempts": 3,
                },
            }
            path = pathlib.Path(work) / "config.yaml"
            path.write_text(json.dumps(config))  # JSON is a YAML subset
            path.chmod(0o644)
            docker("run", "--detach", "--name", container, "--network", "host",
                   "--mount", f"type=bind,src={path},dst=/run/configs/meshcore-mqtt-broker-config.yaml,readonly", image)

            def status():
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{port}/status", timeout=1) as response:
                        value = json.load(response)
                    assert value["instanceId"].startswith(container + "-")
                    return value["meshcoreIo"]
                except OSError:
                    return None

            wait_for(status)
            subprocess.run([client, "-url", f"ws://127.0.0.1:{port}/mqtt", "-advert"], check=True)
            if responses == ["shutdown"]:
                wait_for(lambda: bool(received) or bool(failures))
                started = time.monotonic()
                docker("stop", "--time", "10", container)
                elapsed = time.monotonic() - started
                state = json.loads(docker("inspect", container))[0]["State"]
                assert state["ExitCode"] == 0 and not state["OOMKilled"], state
                print(f"shutdown during signed HTTP upload: exit 0 in {elapsed:.2f}s", flush=True)
            else:
                # completedUploads counts terminal 400 responses as finished;
                # droppedUploads means exhausted attempts/capacity, not HTTP 4xx.
                expected_completed = 1
                expected_dropped = 0

                def completed():
                    value = status()
                    return value and value["completedUploads"] == expected_completed and value["droppedUploads"] == expected_dropped

                wait_for(completed)
                # A terminal response must not schedule another request.
                time.sleep(0.4)
                assert len(received) == len(responses), (responses, len(received))
                assert len({row["data"] for row in received}) == 1, "retry changed the signed upload"
                print(f"HTTP {responses}: {len(received)} verified signatures; completed={expected_completed}, dropped={expected_dropped}", flush=True)
            assert not failures, failures
    except Exception:
        # This container uses only the generated synthetic configuration.
        print(docker("logs", container), flush=True)
        raise
    finally:
        release.set()
        subprocess.run(["docker", "rm", "-f", container], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        server.shutdown()
        server.server_close()
        thread.join()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", help="exact local Docker image ID/digest")
    parser.add_argument("client", help="path to built beacon-paho binary")
    args = parser.parse_args()
    for sequence in [[400], [408, 200], [429, 200], [500, 200], [503, 200], ["timeout", 200], ["shutdown"]]:
        run_case(args.image, args.client, sequence)
