# THE MAX MIX as a container: the server and the built UI, run as a non-root user with its state in /data.
# Build: docker build --build-arg SPOTIFY_CLIENT_ID=<your client ID> -t the-max-mix .
# The client ID is not secret (sign-in uses PKCE), so the image carries it as the default for SPOTIFY_CLIENT_ID.

FROM node:24-slim AS client
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:24-slim AS server-dependencies
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:24-slim
ARG SPOTIFY_CLIENT_ID=
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data \
    SPOTIFY_CLIENT_ID=${SPOTIFY_CLIENT_ID}
WORKDIR /app
COPY --from=server-dependencies /app/server/node_modules server/node_modules
COPY server/package.json server/
COPY server/src server/src
COPY --from=client /app/client/dist client/dist
# Owned by the app's user (the image's `node`, 1000) before it becomes a volume, so a new volume starts out writable.
RUN mkdir /data && chown 1000:1000 /data
USER 1000:1000
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "server/src/index.js"]
