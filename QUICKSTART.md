# Quick Start Guide

Get the Bear Valley Run Checks app running in **under 2 minutes** with zero external dependencies!

## Prerequisites

- Node.js 18+ installed
- That's it! No email, no Google Sheets, no API keys needed.

## Steps

### Option A: Automated Setup (Recommended)

```bash
./setup-dev.sh
```

This script will:
- ✅ Install all dependencies
- ✅ Create and configure the database
- ✅ Set up all required directories
- ✅ Verify everything is working

### Option B: Manual Setup

<details>
<summary>Click to expand manual steps</summary>

### 1. Install Dependencies

```bash
# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

### 2. Initialize Database

```bash
cd ../backend
npx prisma migrate dev --name init --create-only
npx prisma migrate deploy
npx prisma generate

# If tables weren't created, apply SQL manually:
sqlite3 dev.db < prisma/migrations/*/migration.sql
```

### 3. Create Data Directory

```bash
mkdir -p data
```

</details>

### 2. Start Development Servers

**Terminal 1 - Backend:**
```bash
cd backend
npm run dev
```

You should see:
```
🚀 Server running on port 3000
📧 Superusers: admin@bearvalley.com, patrol@bearvalley.com

⚡ DEV MODE: Direct login available at POST /auth/dev-login
   No magic links or email setup required!
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```

### 3. Login

1. Open http://localhost:8080 in your browser
2. You'll see a **yellow DEV MODE banner** - this means direct login is enabled!
3. Enter one of the superuser emails from config.yaml:
   - `admin@bearvalley.com`
   - `patrol@bearvalley.com`
4. Click the green **"Login (DEV - No Email)"** button
5. You're in! 🎉

## What Just Happened?

- ✅ Superusers from `config.yaml` were automatically created in the database
- ✅ You logged in without any magic link or email
- ✅ Run checks are stored in memory (no Google Sheets needed)
- ✅ Everything runs locally with zero external dependencies

## Next Steps

### Add More Users (via Admin Panel)

1. Login as a superuser (see above)
2. Click the **Admin** tab
3. Enter a new user's email and name
4. Click **Create User**
5. In DEV mode, you can immediately login as that user (no email needed)

### Track Run Checks

1. Click the **Runs** tab
2. Tap/click runs to add them to your cart
3. Click **Continue**
4. Select a patroller (or type a new name)
5. Choose a time
6. Click **Submit**
7. See the checks appear in the **History** and **Patrollers** tabs

### Customize Runs

Edit `backend/config.yaml` to modify:
- Superusers (email + name)
- Run sections and names
- Additional patroller names

Restart the backend server to see changes.

## Troubleshooting

### Port Already in Use

If port 3000 or 8080 is already in use, edit:
- Backend: `backend/.env` → change `PORT=3000`
- Frontend: `frontend/webpack.config.js` → change `port: 8080`

### Can't Login

Make sure:
1. Backend server is running on port 3000
2. You see the "DEV MODE" banner (yellow box) on the login page
3. You're using an email from `backend/config.yaml` superusers list
4. `NODE_ENV` is NOT set to `production` in `backend/.env`

### Database Locked

If you see "database locked" errors:
```bash
cd backend
rm dev.db dev.db-journal
npx prisma migrate dev --name init
```

## Production Setup

Ready to deploy? See [README.md](README.md) for production deployment instructions including:
- Email/SMTP configuration for magic links
- Google Sheets integration
- Docker deployment
- Environment variables
