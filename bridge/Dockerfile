FROM node:24.18.0-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src

USER node

CMD ["npm", "start"]
