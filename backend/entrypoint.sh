#!/bin/sh
set -e

echo "=== Starting Bear Valley Run Checks ==="

# Start as root only to fix ownership of the (possibly root-owned) data volume,
# then run everything else as the unprivileged "node" user
if [ "$(id -u)" = "0" ]; then
  mkdir -p /app/data
  chown -R node:node /app/data
  exec su-exec node "$0" "$@"
fi

# Check if migrations exist
if [ ! -d "/app/prisma/migrations" ]; then
  echo "WARNING: No migrations directory found at /app/prisma/migrations/"
  echo "Skipping migrations..."
else
  echo "Running database migrations..."
  npx prisma migrate deploy
fi

echo "Starting server..."
exec node dist/index.js
