#!/usr/bin/env bash
set -euo pipefail

# Run migrations before starting the endpoint. Idempotent — Ecto
# tracks applied versions in schema_migrations, so booting a
# second container against the same DB is a no-op.
/app/bin/backend eval 'Backend.Release.migrate()'

# Hand off to CMD (release start)
exec "$@"
