FROM node:24.16.0-bookworm-slim

WORKDIR /app

# better-sqlite3 is a native dependency and needs build tools.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data \
  && chown node:node /data

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 8883
VOLUME ["/data"]

USER node

CMD ["npm", "start"]
