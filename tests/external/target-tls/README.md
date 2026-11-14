# Target MQTT TLS scratch-image check

`run-target-tls.sh` builds the production `scratch` image and starts this
minimal synthetic MQTT 3.1.1 broker behind Go TLS. It verifies:

1. a mounted synthetic CA and `localhost` SAN connect successfully;
2. the same trusted chain is rejected for a mismatched `127.0.0.1` hostname;
3. the synthetic chain is rejected when its CA is not mounted.
4. disconnecting the test server makes the bridge go offline, and restarting
   it restores the connection.

The test uses host networking and temporary certificates, containers and
configuration. It never needs registry credentials or production secrets.

Set `MESHCORE_TEST_IMAGE` to an exact local deployed image ID to test that
artifact instead of building a new image. This image is never deleted by the
script. Set `MESHCORE_TLS_SERVER` to a prebuilt version of `server.go` on hosts
without Go. The script owns and stops the server process directly.

With `MESHCORE_PAHO_CLIENT` pointing to the built `beacon-paho` probe, it also
publishes telemetry during the outage and after recovery, asserting offline
drops and subsequent successful writes through `/status`. Python 3 is required
for these counter assertions. Queue saturation remains covered by Rust tests;
this script deliberately does not overload a production Target broker.
