# syntax=docker/dockerfile:1

FROM node:22-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY web/package.json ./web/package.json
RUN npm ci

FROM deps AS build
COPY server ./server
COPY web ./web
RUN npm run build

FROM node:22-slim AS app
WORKDIR /app
ENV NODE_ENV=production \
    PORT=5174 \
    TRACKFOLIO_DB=/data/trackfolio.sqlite

COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY web/package.json ./web/package.json
RUN npm ci --omit=dev --workspace server && npm cache clean --force

COPY --from=build --chown=node:node /app/server/dist ./server/dist
COPY --from=build --chown=node:node /app/web/dist ./web/dist
RUN mkdir -p /data && chown -R node:node /app /data
USER node

EXPOSE 5174
CMD ["node", "server/dist/index.js"]
