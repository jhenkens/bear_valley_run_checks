#!/bin/bash

# Setup script for Bear Valley Run Checks - Development Environment
# Run this once to set up everything you need

set -e  # Exit on error

echo "🏔️  Bear Valley Run Checks - Development Setup"
echo "=============================================="
echo ""

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Error: Node.js 18 or higher is required. You have: $(node -v)"
    exit 1
fi

echo "✓ Node.js $(node -v) detected"
echo ""

# Install backend dependencies
echo "📦 Installing backend dependencies..."
cd backend
npm install --silent
echo "✓ Backend dependencies installed"
echo ""

# Install frontend dependencies
echo "📦 Installing frontend dependencies..."
cd ../frontend
npm install --silent
echo "✓ Frontend dependencies installed"
echo ""

# Setup database
cd ../backend
echo "🗄️  Setting up database..."

# Create .env if it doesn't exist
if [ ! -f .env ]; then
    cp .env.example .env
    echo "✓ Created .env file"
fi

# Create data directory for sessions
mkdir -p data
echo "✓ Created data directory"

# Remove old database if it exists
if [ -f dev.db ]; then
    echo "⚠️  Removing old database..."
    rm -f dev.db dev.db-journal
fi

# Create new migration if needed
if [ ! -d "prisma/migrations" ] || [ -z "$(ls -A prisma/migrations)" ]; then
    echo "📝 Creating database migration..."
    export CI=false
    npx prisma migrate dev --name init --create-only > /dev/null 2>&1
fi

# Apply migrations
echo "🔨 Creating database..."
npx prisma migrate deploy > /dev/null 2>&1

# If migrate deploy didn't create tables, apply SQL manually
if ! sqlite3 dev.db ".tables" 2>/dev/null | grep -q "User"; then
    echo "🔧 Applying schema manually..."
    MIGRATION_SQL=$(find prisma/migrations -name "migration.sql" -type f | head -1)
    if [ -n "$MIGRATION_SQL" ]; then
        sqlite3 dev.db < "$MIGRATION_SQL"
    fi
fi

# Generate Prisma client
npx prisma generate > /dev/null 2>&1
echo "✓ Database created and configured"
echo ""

# Verify tables exist
TABLE_COUNT=$(sqlite3 dev.db ".tables" 2>/dev/null | wc -w)
if [ "$TABLE_COUNT" -eq 3 ]; then
    echo "✓ Database tables verified (User, MagicLink, Session)"
else
    echo "⚠️  Warning: Expected 3 tables, found $TABLE_COUNT"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "📚 Next steps:"
echo "   1. Start backend:  cd backend && npm run dev"
echo "   2. Start frontend: cd frontend && npm run dev"
echo "   3. Open http://localhost:8080"
echo "   4. Login with: admin@bearvalley.com (no email needed in DEV mode)"
echo ""
echo "📖 See QUICKSTART.md for detailed instructions"
