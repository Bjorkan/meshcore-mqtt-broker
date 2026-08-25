FROM oven/bun:1.4.0-slim@sha256:e0ee68d16ccb9927bf02aa7dd8fd4bf3369ee6d46da04faa72b05ce8bfd135f6

WORKDIR /app

ENV NODE_ENV=production

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY LICENSE.md THIRD_PARTY_NOTICES.md ./
COPY src ./src
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh /app/src/cli.ts \
  && ln -s /app/src/cli.ts /usr/local/bin/mc-mqtt

EXPOSE 8883

HEALTHCHECK --interval=45s --timeout=50s --start-period=20s --retries=3 CMD ["setpriv", "--reuid=bun", "--regid=bun", "--init-groups", "bun", "src/healthcheck.ts"]

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["bun", "src/server.ts"]
