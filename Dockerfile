FROM rust:1.99-bookworm@sha256:48b7f435b8fc6378ce43b44f15e3a47fd8919b2825f835c39bd4bd3da50af5b8 AS builder

WORKDIR /app
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY src ./src
RUN set -eux; \
  cargo build --locked --release; \
  mkdir -p /runtime/usr/local/bin /runtime/etc/ssl/certs; \
  cp target/release/meshcore-mqtt-broker /runtime/usr/local/bin/; \
  cp /etc/ssl/certs/ca-certificates.crt /runtime/etc/ssl/certs/; \
  ldd target/release/meshcore-mqtt-broker \
    | awk '{ for (field = 1; field <= NF; field++) if ($field ~ /^\//) print $field }' \
    | xargs -r cp --parents --target-directory=/runtime

FROM scratch

COPY --from=builder /runtime /

ENV PATH="/usr/local/bin"
USER 65532:65532

EXPOSE 8883

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 CMD ["/usr/local/bin/meshcore-mqtt-broker", "healthcheck"]

ENTRYPOINT ["/usr/local/bin/meshcore-mqtt-broker"]
