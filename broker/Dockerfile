FROM node:24-bookworm-slim

WORKDIR /app

# better-sqlite3 is a native dependency and needs build tools.
RUN apt-get update \
  && apt-get upgrade -y \
  && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data \
  && chown node:node /data

# Refresh npm from the base image and patch its bundled undici dependency so
# Docker Scout does not report CVE-2026-12151 from npm's own dependency tree.
RUN npm install -g npm@latest \
  && npm --prefix "$(npm root -g)/npm" install undici@6.27.0 --omit=dev

COPY package*.json ./
RUN npm ci

COPY . .
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8883
VOLUME ["/data"]

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "start"]