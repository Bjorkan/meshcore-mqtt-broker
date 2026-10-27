FROM rust:1.99-bookworm AS builder

WORKDIR /app
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY src ./src
RUN cargo build --locked --release

FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && apt-get install -y --no-install-recommends ca-certificates util-linux \
  && groupadd --system broker \
  && useradd --system --gid broker --no-create-home broker \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/meshcore-mqtt-broker /usr/local/bin/meshcore-mqtt-broker
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8883

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["meshcore-mqtt-broker"]
