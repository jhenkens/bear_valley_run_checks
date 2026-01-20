#!/bin/sh
set -e

echo "=== Starting Bear Valley Run Checks ==="
echo "Working directory: $(pwd)"
echo "Checking Prisma setup..."

# Ensure the database directory exists
mkdir -p /app/data

# Debug: List directory structure
echo "App directory contents:"
ls -la /app/

echo "Prisma directory contents:"
ls -la /app/prisma/ || echo "ERROR: No prisma directory!"

echo "Migrations:"
ls -la /app/prisma/migrations/ || echo "ERROR: No migrations directory!"

# Generate Prisma Client (in case it's not properly copied)
echo "Generating Prisma Client..."
npx prisma generate

echo "Running database migrations..."
npx prisma migrate deploy

echo "Starting server..."
exec node dist/index.js
