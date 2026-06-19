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

COPY package*.json ./
RUN npm ci

COPY . .
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8883
VOLUME ["/data"]

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "start"]