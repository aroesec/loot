# syntax=docker/dockerfile:1

# Self-hosting path. Vercel does not use this file — it builds from source.
#
# Three stages so the runtime image carries neither the toolchain nor the
# source: deps for the install cache, build for the compile, runner for what
# actually ships.

# Pinned to a patch, not a moving `22-alpine` tag. An image rebuild upstream
# should never change what this produces.
ARG NODE_IMAGE=node:22.21-alpine

# pnpm is installed directly rather than through corepack. corepack is no
# longer reliably present in the Node images and `corepack enable` started
# failing with exit 127 mid-build — a break that arrives on a stranger's
# machine, on the path they use to self-host, with nothing changed here.
# Kept in step with `packageManager` in package.json.
ARG PNPM_VERSION=11.20.0

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ARG PNPM_VERSION
RUN npm install -g pnpm@${PNPM_VERSION}
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM ${NODE_IMAGE} AS build
WORKDIR /app
ARG PNPM_VERSION
RUN npm install -g pnpm@${PNPM_VERSION}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Next validates env at build time for statically analysed routes. These are
# placeholders for the compile only; the real values arrive at runtime.
ENV BUILD_STANDALONE=true \
    DATABASE_URL=postgres://build/build \
    APP_PASSWORD=build \
    SESSION_SECRET=build-time-placeholder-value-32chars
RUN pnpm build

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0

# Unprivileged: this process holds database credentials and bank access tokens.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

# Migrations run from the entrypoint, so the compiled sources and the migration
# SQL have to be present in the runtime image.
COPY --from=build --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=build --chown=nextjs:nodejs /app/src/db ./src/db
COPY --from=build --chown=nextjs:nodejs /app/node_modules/.bin/tsx ./node_modules/.bin/tsx
COPY --from=build --chown=nextjs:nodejs /app/node_modules/tsx ./node_modules/tsx
COPY --from=build --chown=nextjs:nodejs /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=build --chown=nextjs:nodejs /app/tsconfig.json ./tsconfig.json
COPY --chown=nextjs:nodejs docker-entrypoint.sh ./

USER nextjs
EXPOSE 3000

ENTRYPOINT ["/bin/sh", "./docker-entrypoint.sh"]
