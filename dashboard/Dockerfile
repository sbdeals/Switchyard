# Switchyard dashboard — production image.
#
# Multi-stage build around Next.js standalone output: the runner stage carries
# only the traced server bundle, not the full node_modules tree.
#
#   docker build -t ghcr.io/sbdeals/switchyard:dev dashboard/
#
# The container needs, at run time:
#   --network dokploy-network                          reach Dokploy by service DNS
#   -v /var/run/docker.sock:/var/run/docker.sock       live logs/metrics (dockerode)
#   -e DOKPLOY_URL / DOKPLOY_EMAIL / DOKPLOY_PASSWORD  BFF sign-in
#
# Runs as root deliberately: it drives the mounted Docker socket, and it is an
# admin tool that already holds the Dokploy admin credentials. Revisit together
# with dashboard auth.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3001 \
    HOSTNAME=0.0.0.0
# Set by the release workflow; surfaced at /api/health.
ARG SWITCHYARD_VERSION=dev
ENV SWITCHYARD_VERSION=$SWITCHYARD_VERSION

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/api/health || exit 1
CMD ["node", "server.js"]
