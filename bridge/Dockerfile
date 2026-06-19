FROM node:24-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get upgrade -y \
  && rm -rf /var/lib/apt/lists/*

# Refresh npm from the base image and patch its bundled undici dependency so
# Docker Scout does not report CVE-2026-12151 from npm's own dependency tree.
RUN npm install -g npm@latest \
  && npm --prefix "$(npm root -g)/npm" install undici@6.27.0 --omit=dev

COPY package*.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src

CMD ["npm", "start"]