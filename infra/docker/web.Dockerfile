# Built from repo root: docker build -f infra/docker/web.Dockerfile .
FROM node:20-alpine AS base
WORKDIR /repo
# Keep corepack's pnpm download inside /repo so the unprivileged runtime user
# can run `pnpm` (admin CLIs) without fetching anything at runtime.
ENV COREPACK_HOME=/repo/.corepack
RUN corepack enable

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/traccar-client/package.json packages/traccar-client/package.json
COPY packages/config/package.json packages/config/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @rio-gps/web build

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Runs as the image's unprivileged `node` user (uid 1000), not root.
COPY --from=build --chown=node:node /repo /repo
USER node
WORKDIR /repo/apps/web
EXPOSE 3000
CMD ["pnpm", "start"]
