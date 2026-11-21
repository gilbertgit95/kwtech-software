# The API image (#213, #133 P1). Built from the repository root:
#   docker build -f deploy/docker/api.Dockerfile -t kwtech-api .
# Holds no secret: every setting comes from the install's .env at start.

ARG NODE_VERSION=22
# The Postgres major the shop's database runs (compose.yml). pg_dump and
# pg_restore MUST match it, or a restore of a newer dump can fail.
ARG POSTGRES_MAJOR=17

FROM node:${NODE_VERSION}-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
# git for the repository's `prepare` hook (lefthook install), which pnpm
# install runs. Build stage only: it never reaches the final image.
RUN apt-get update -q && apt-get install -y -q --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/* \
 && corepack enable
WORKDIR /repo
COPY . .
# An empty repository for lefthook to install into: .git is not in the
# build context (.dockerignore), and the hooks do nothing in an image.
RUN git init -q && pnpm install --frozen-lockfile
# Built from the public templates, as CI builds (ci.yml): `prisma generate`
# resolves DATABASE_URL eagerly though it opens no connection, and turbo
# passes a task only the variables turbo.json names, so the file is the way
# in. Removed straight after, so no env file reaches the image.
RUN cp apps/web-server/.env.example apps/web-server/.env.local \
 && pnpm turbo run build --filter=@kwtech/web-server... \
 && rm apps/web-server/.env.local
# Only what the API runs with: the API and the packages it uses, reinstalled
# without the web app and the print agent (and Next with them).
#
# ⚠ NOT --prod. The modules declare Nest as an optional peer and a dev
# dependency (.claude/rules/modules.md, package.json), so a production
# install leaves @nestjs/common out of their folders and the API fails at
# its first import ("Cannot find module '@nestjs/common'", found booting the
# image). This is the layout the pm2 setup runs with.
RUN rm -rf apps/web-app apps/print-agent node_modules apps/*/node_modules packages/*/node_modules \
 && pnpm install --frozen-lockfile --filter "@kwtech/web-server..." --config.confirmModulesPurge=false

FROM node:${NODE_VERSION}-bookworm-slim
ARG POSTGRES_MAJOR
# openssl and certificates for Prisma's schema engine (migrate deploy) and
# outgoing TLS (mail); the PostgreSQL client from the Postgres project's own
# repository, at the database's major version, for module-backup.
RUN apt-get update -q \
 && apt-get install -y -q --no-install-recommends ca-certificates curl gnupg openssl \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
 && . /etc/os-release \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update -q \
 && apt-get install -y -q --no-install-recommends postgresql-client-${POSTGRES_MAJOR} \
 && apt-get purge -y -q curl gnupg && apt-get autoremove -y -q \
 && rm -rf /var/lib/apt/lists/*
# Links the image to its repository on GitHub's registry (its page, its access).
LABEL org.opencontainers.image.source=https://github.com/gilbertgit95/kwtech-software
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /repo /app
COPY deploy/docker/api-entrypoint.sh /usr/local/bin/kwtech
# Plain Dockerfile only (no BuildKit-only flags such as COPY --chmod), so the
# images build with any Docker, the legacy builder included.
RUN chmod 755 /usr/local/bin/kwtech
USER node
WORKDIR /app/apps/web-server
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["kwtech"]
CMD ["serve"]
