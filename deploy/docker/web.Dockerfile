# The web app image (#213, #133 P1). Built from the repository root:
#   docker build -f deploy/docker/web.Dockerfile -t kwtech-web .

ARG NODE_VERSION=22

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
# ⚠ Fixed at BUILD, so the same for every shop (#133, "Nothing is built at a
# shop"): Local network on (every Docker install is a shop's own), and the
# realtime address as a PATH, which works at whatever address the shop has.
# Nothing that differs per shop may ever be a NEXT_PUBLIC_ value.
ENV NEXT_OUTPUT=standalone \
    NEXT_PUBLIC_LOCAL_NETWORK=on \
    NEXT_PUBLIC_WS_URL=/api/v1/graphql \
    APP_ENV=production
# The public templates, as CI builds (ci.yml), removed straight after so no
# env file reaches the image. NEXT_PUBLIC_ values above win over the file's.
RUN cp apps/web-server/.env.example apps/web-server/.env.local \
 && cp apps/web-app/.env.example apps/web-app/.env.local \
 && pnpm turbo run build --filter=@kwtech/web-app... \
 && rm apps/web-server/.env.local apps/web-app/.env.local

FROM node:${NODE_VERSION}-bookworm-slim
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=8081
WORKDIR /app
# The standalone server and the node_modules it traced (from the repository
# root, so the workspace packages are in), then what it serves as files.
COPY --from=build --chown=node:node /repo/apps/web-app/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web-app/.next/static ./apps/web-app/.next/static
COPY --from=build --chown=node:node /repo/apps/web-app/public ./apps/web-app/public
USER node
EXPOSE 8081
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8081)+'/auth/signin').then(r=>process.exit(r.status<500?0:1),()=>process.exit(1))"
CMD ["node", "apps/web-app/server.js"]
