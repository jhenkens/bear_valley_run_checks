#!/bin/sh
set -e

echo "=== Starting Bear Valley Run Checks ==="

# Ensure the database directory exists
mkdir -p /app/data

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
