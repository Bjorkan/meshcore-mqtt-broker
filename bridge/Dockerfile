FROM ubuntu:24.04

WORKDIR /app

# Install Node.js
RUN apt-get update && apt-get install -y --no-install-recommends \
    nodejs \
    npm \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src

CMD ["npm", "start"]
