#!/bin/sh
set -e

# Migrate and seed before serving. Both are idempotent, so a restart is safe
# and an upgrade applies its own schema changes without a separate step.
echo "Applying migrations..."
./node_modules/.bin/tsx src/db/migrate.ts

echo "Seeding taxonomy..."
./node_modules/.bin/tsx src/db/seed.ts

echo "Starting Loot on :${PORT:-3000}"
exec node server.js
