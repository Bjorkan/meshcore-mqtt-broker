FROM node:24-bookworm-slim

WORKDIR /app

# better-sqlite3 is a native dependency and needs build tools.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 8883

CMD ["npm", "start"]
