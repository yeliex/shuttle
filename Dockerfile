FROM node:24-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable

FROM base AS build

WORKDIR /workspace
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/companion/package.json apps/companion/package.json
COPY apps/relay/package.json apps/relay/package.json
COPY apps/relay/prisma.config.ts apps/relay/prisma.config.ts
COPY apps/relay/prisma apps/relay/prisma
COPY apps/site/package.json apps/site/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/ui/package.json packages/ui/package.json

RUN --mount=type=cache,id=shuttle-pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY . .
RUN pnpm build:assets
RUN pnpm --filter @shuttle/relay build
RUN --mount=type=cache,id=shuttle-pnpm,target=/pnpm/store \
    pnpm --filter @shuttle/relay --prod deploy --legacy /opt/shuttle-relay
RUN cp -R apps/relay/dist apps/relay/.assets apps/relay/prisma apps/relay/prisma.config.ts /opt/shuttle-relay/

FROM base AS runtime

ENV DATABASE_URL=file:/data/shuttle.db
ENV NODE_ENV=production
ENV PORT=8787

WORKDIR /app
COPY --from=build /opt/shuttle-relay/ ./

VOLUME ["/data"]
EXPOSE 8787

CMD ["sh", "-c", "RUST_LOG=info ./node_modules/.bin/prisma migrate deploy && node dist/server.mjs"]
