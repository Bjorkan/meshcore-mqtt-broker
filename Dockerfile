FROM oven/bun:1.4.3-slim@sha256:14a223fa35747ec728bce300ef85888bc5f7958164d15bbba6a54b22b52a3288

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
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8883

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 CMD ["bun", "src/healthcheck.ts"]

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["bun", "src/server.ts"]
