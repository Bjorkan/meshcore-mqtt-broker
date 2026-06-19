FROM node:24-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get upgrade -y \
  && rm -rf /var/lib/apt/lists/*

# Refresh npm from the base image so bundled npm dependencies, including undici,
# include published security fixes before Docker Scout scans the final image.
RUN npm install -g npm@latest

COPY package*.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src

CMD ["npm", "start"]