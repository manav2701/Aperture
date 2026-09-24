# Builds one Aperture service (api, gateway, worker, signer) into a minimal runtime image.
#   docker build -f infra/docker/service.Dockerfile --build-arg APP=gateway -t aperture-gateway .
# Services are bundled by esbuild into a single dist/index.cjs, so the runtime stage needs
# no node_modules and no package manager.

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-slim AS build
ARG APP
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo
COPY . .
RUN test -n "$APP" && test -d "apps/$APP" \
  && pnpm install --frozen-lockfile --filter "@aperture/${APP}..." \
  && pnpm --filter "@aperture/${APP}" build

FROM node:${NODE_VERSION}-slim AS runtime
ARG APP
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/${APP}/dist ./dist
USER node
CMD ["node", "--enable-source-maps", "dist/index.mjs"]
