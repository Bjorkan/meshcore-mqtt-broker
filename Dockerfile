FROM node:24.19.0-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03 AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build \
  && npm prune --omit=dev

FROM node:24.19.0-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03 AS runtime

WORKDIR /app

ENV NODE_ENV=production

RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY LICENSE.md THIRD_PARTY_NOTICES.md ./
COPY LICENSES ./LICENSES
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh /app/dist/cli.js \
  && ln -s /app/dist/cli.js /usr/local/bin/mc-mqtt

EXPOSE 8883

HEALTHCHECK --interval=45s --timeout=50s --start-period=20s --retries=3 CMD ["setpriv", "--reuid=node", "--regid=node", "--init-groups", "node", "dist/healthcheck.js"]

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
