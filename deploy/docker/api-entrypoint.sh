#!/bin/sh
# The API image's commands (#213). `kwtech <command>`:
#
#   serve            (the default) apply migrations, sync the reference data,
#                    then run the API. A failed migration stops the start,
#                    loudly: the API never runs on a half-updated database.
#   first-setup      a NEW install's organization, workspace and first people
#                    (#206): the reference data and the starting plans, then
#                    the questions. Refuses on an install already set up.
#   recover-account  a new password for any account, typed here (#133 P3):
#                    for a shop without email, or a forgotten super admin.
#   <anything else>  run as given (a shell, a one-off script).
set -e
cd /app/apps/web-server

# The seeders that are reference data (sync), plus the starting plan
# catalogue, which never overwrites a plan (seed/README.md).
SETUP_SEEDERS="permissions:features,permissions:app-roles,permissions:defaults,jobs:processes,permissions:plans"

case "${1:-serve}" in
  serve)
    echo "kwtech: applying database migrations"
    node_modules/.bin/prisma migrate deploy
    echo "kwtech: syncing reference data"
    node dist/seed/run.js --phase=sync
    exec node dist/main.js
    ;;
  first-setup)
    node dist/seed/run.js --phase=seed --only="$SETUP_SEEDERS"
    # The app is booted to write through its own services, so the job runner
    # must be off here: the running API already has one.
    JOBS_RUNNER=off exec node dist/setup/first-setup.js
    ;;
  recover-account)
    JOBS_RUNNER=off exec node dist/setup/recover-account.js
    ;;
  *)
    exec "$@"
    ;;
esac
