# Moqoqo server. Build from the REPO ROOT so the shared API contract is in the context:
#   docker build -f server/Dockerfile -t moqoqo-server .
# (Untested: Docker was not available when this was written.)

FROM node:24-alpine AS build
WORKDIR /app
COPY shared/ ./shared/
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci
COPY server/ ./server/
RUN cd server && npm run build

FROM node:24-alpine AS deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24-alpine
ENV NODE_ENV=production PORT=4000 HOST=0.0.0.0 DATA_DIR=/data
WORKDIR /app/server
COPY --from=deps /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY server/package.json ./
# PGlite data lives here when DATABASE_URL is not set; mount a volume to keep it.
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:4000/health || exit 1
CMD ["node", "dist/index.js"]
