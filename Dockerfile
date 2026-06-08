# syntax=docker/dockerfile:1

FROM node:22-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY app/server/package.json ./app/server/package.json
COPY app/web/package.json ./app/web/package.json
RUN npm ci

FROM deps AS build
COPY app/server ./app/server
COPY app/web ./app/web
RUN npm run build

FROM node:22-slim AS app
WORKDIR /app
ENV NODE_ENV=production \
    PORT=5174 \
    TRACKFOLIO_DB=/data/trackfolio.sqlite

COPY package.json package-lock.json ./
COPY app/server/package.json ./app/server/package.json
COPY app/web/package.json ./app/web/package.json
RUN npm ci --omit=dev --workspace @trackfolio/server && npm cache clean --force

COPY --from=build --chown=node:node /app/app/server/dist ./app/server/dist
COPY --from=build --chown=node:node /app/app/web/dist ./app/web/dist
RUN mkdir -p /data && chown -R node:node /app /data
USER node

EXPOSE 5174
CMD ["node", "app/server/dist/index.js"]
