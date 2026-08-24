# @kwtech/web-server

NestJS API: GraphQL (code-first) + `graphql-ws` subscriptions + REST, over
Prisma 7 and Postgres. Emits both contracts — `schema.graphql` and
`openapi.json` — which `@kwtech/web-app` generates its client types from.

Not scaffolded yet. Generate with `nest new` in Phase 2 (see
[docs/PLAN.md](../../docs/PLAN.md) §10), then mirror the structure of
`../../../masterdb-mgt-tool/apps/mgt-backend`.
