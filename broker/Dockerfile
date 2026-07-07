FROM node:24.17.0-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
  && apt-get upgrade -y --with-new-pkgs \
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
  && apt-get install -y --no-install-recommends libcap2-bin \
  && apt-get upgrade -y --with-new-pkgs \
  && setcap 'cap_net_bind_service=+ep' /usr/local/bin/node \
  && apt-get purge -y --auto-remove libcap2-bin \
  && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/* \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh /app/dist/cli.js \
  && ln -s /app/dist/cli.js /usr/local/bin/mc-mqtt

EXPOSE 8080 8883

HEALTHCHECK --interval=45s --timeout=50s --start-period=20s --retries=3 CMD ["node", "dist/healthcheck.js"]

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
