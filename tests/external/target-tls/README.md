# Target MQTT TLS scratch-image check

`run-target-tls.sh` builds the production `scratch` image and starts this
minimal synthetic MQTT 3.1.1 broker behind Go TLS. It verifies:

1. a mounted synthetic CA and `localhost` SAN connect successfully;
2. the same trusted chain is rejected for a mismatched `127.0.0.1` hostname;
3. the synthetic chain is rejected when its CA is not mounted.

The test uses host networking and temporary certificates, containers and
configuration. It never needs registry credentials or production secrets.
