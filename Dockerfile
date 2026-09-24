# syntax=docker/dockerfile:1

# Multi-stage so the runtime image carries no compiler, no dev dependencies and
# no source. Smaller image, faster cold start, smaller attack surface.

FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /app

# Dependencies are installed in their own stage and copied forward, so editing a
# source file does not invalidate the install layer.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# Production dependencies resolved separately rather than pruned, which keeps the
# result reproducible from the lockfile alone.
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --prod

FROM node:24-alpine AS runtime
# PID 1 in a container does not reap zombies or forward signals by default.
# Without an init, SIGTERM never reaches Node and every deploy waits for the
# orchestrator's kill timeout instead of shutting down gracefully.
RUN apk add --no-cache dumb-init

WORKDIR /app
ENV NODE_ENV=production

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./

# Never root. A container escape should not start with privileges.
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('node:http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
