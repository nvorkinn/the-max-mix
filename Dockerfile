# THE MAX MIX as a container: the built UI and a tiny static file server, run as a non-root user. No state, no volume.
# Build: docker build --build-arg SPOTIFY_CLIENT_ID=<your client ID> -t the-max-mix .
# The client ID is not secret (sign-in uses PKCE); it is baked into the built JavaScript. Without it, type the ID into
# Settings in the browser instead.

FROM node:24-slim AS client
ARG SPOTIFY_CLIENT_ID=
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN VITE_SPOTIFY_CLIENT_ID="${SPOTIFY_CLIENT_ID}" npm run build

FROM node:24-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY scripts/serve.mjs scripts/
COPY --from=client /app/client/dist client/dist
USER 1000:1000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "scripts/serve.mjs"]
