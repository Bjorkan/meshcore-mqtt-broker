FROM oven/bun:1.4.1-slim@sha256:887d0f37f674c69984be4e397fef29ca0d74df1e75155431abbe857258bffde5

WORKDIR /app

ENV NODE_ENV=production

# The pinned base digest can carry outdated Debian packages; upgrade the
# installed set so the Docker Scout critical/high CVE gate stays green on
# every build.
RUN apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY LICENSE.md THIRD_PARTY_NOTICES.md ./
COPY src ./src
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh /app/src/cli.ts \
  && ln -s /app/src/cli.ts /usr/local/bin/mc-mqtt

EXPOSE 8883

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 CMD ["bun", "src/healthcheck.ts"]

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["bun", "src/server.ts"]
