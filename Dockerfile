FROM rust:1.99-bookworm@sha256:48b7f435b8fc6378ce43b44f15e3a47fd8919b2825f835c39bd4bd3da50af5b8 AS builder

WORKDIR /app
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY src ./src
RUN cargo build --locked --release

FROM debian:bookworm-slim@sha256:7ff6ba31527b9e336162fa061746c366c4b2032f4d2cff2078bea43f78efe3f8

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates libssl3 util-linux \
  && groupadd --system broker \
  && useradd --system --gid broker --no-create-home broker \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/meshcore-mqtt-broker /usr/local/bin/meshcore-mqtt-broker
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8883

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 CMD ["meshcore-mqtt-broker", "healthcheck"]

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["meshcore-mqtt-broker"]
