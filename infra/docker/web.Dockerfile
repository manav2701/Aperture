# The web app for self-hosting (plan/phases/phase-10 §10.9). The /api proxy target and the media
# origin are fixed at build time:
#   docker build -f infra/docker/web.Dockerfile --build-arg API_INTERNAL_URL=http://api:4000 \
#     --build-arg MEDIA_ORIGIN=https://<bucket-host> -t aperture-web .
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-slim AS build
ARG API_INTERNAL_URL=http://api:4000
ARG MEDIA_ORIGIN=
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_STANDALONE=1 API_INTERNAL_URL=${API_INTERNAL_URL} MEDIA_ORIGIN=${MEDIA_ORIGIN} NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter "@aperture/web..." && pnpm --filter @aperture/web build

FROM node:${NODE_VERSION}-slim AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
