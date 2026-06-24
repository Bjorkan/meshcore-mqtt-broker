FROM node:24.17.0-bookworm-slim AS build

WORKDIR /app

# better-sqlite3 is a native dependency and needs build tools.
RUN apt-get update \
  && apt-get upgrade -y --with-new-pkgs \
  && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build \
  && npm prune --omit=dev

FROM node:24.17.0-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production

RUN apt-get update \
  && apt-get upgrade -y --with-new-pkgs \
  && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/* \
  && mkdir -p /data \
  && chown node:node /data \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY allowed_regions.yaml ./
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8883
VOLUME ["/data"]

HEALTHCHECK --interval=45s --timeout=50s --start-period=20s --retries=3 CMD ["node", "dist/healthcheck.js"]

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
