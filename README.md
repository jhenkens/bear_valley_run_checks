# Bear Valley Run Checks

Mobile-first web application for ski patrol to track run checks with real-time updates.

**🚀 [Quick Start Guide](QUICKSTART.md)** - Get running in under 2 minutes with zero external dependencies!

## Features

- **Magic Link Authentication** - Passwordless email login
- **Run Check Management** - Track run checks with timestamps
- **Real-time Updates** - Socket.io for instant updates across devices
- **Mobile-First Design** - Optimized for use on phones and tablets
- **Color Coding** - Red/yellow/green indicators based on time since last check
- **Admin Panel** - User management for administrators
- **Flexible Run Providers** - Support for config-based or Google Sheets-based run lists

## Tech Stack

- **Backend**: Node.js, Express, TypeScript, Prisma, Socket.io
- **Frontend**: Alpine.js, TypeScript, Webpack
- **Database**: SQLite (development), PostgreSQL (production recommended)
- **Authentication**: Magic link via email

## Getting Started

### Prerequisites

- Node.js 18+ (Node.js 20+ recommended for production)
- npm or yarn

### Quick Start (Development - No External Dependencies Required!)

The application runs in development mode by default with **zero external dependencies**:
- ✅ No email/SMTP setup required
- ✅ No Google Sheets API setup required
- ✅ Direct login without magic links
- ✅ Superusers auto-created from config.yaml

Simply install and run - that's it!

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd bear-valley-run-checks
   ```

2. Install backend dependencies:
   ```bash
   cd backend
   npm install
   ```

3. Install frontend dependencies:
   ```bash
   cd ../frontend
   npm install
   ```

4. Set up environment variables:
   ```bash
   cd ../backend
   cp .env.example .env
   # For development, the defaults work! No changes needed.
   # For production, edit .env with your SMTP and other settings
   ```

5. Initialize the database:
   ```bash
   npx prisma migrate dev --name init
   npx prisma generate
   ```

6. **(Optional)** Customize superusers:
   - Edit `backend/config.yaml` to add/modify superusers
   - Superusers are automatically created in the database on server startup

### Development

Run backend and frontend in separate terminals:

```bash
# Terminal 1 - Backend
cd backend
npm run dev

# Terminal 2 - Frontend
cd frontend
npm run dev
```

Access the application at http://localhost:8080

**First Login:**
1. Enter any superuser email from `config.yaml` (default: admin@bearvalley.com)
2. Click "Login (DEV - No Email)"
3. You're in! No magic link required.

## Development Mode Features

When `NODE_ENV` is not set to `production`, the application enables several developer-friendly features:

### 🔓 Direct Login (No Email Required)
- Bypass magic link authentication
- Login instantly with any user email in the database
- No SMTP configuration needed
- Look for the green "Login (DEV - No Email)" button

### 👥 Auto-Created Superusers
- Superusers defined in `config.yaml` are automatically created/updated in the database on startup
- No manual database setup required
- Names are synced from config on every restart

### 📊 In-Memory Run Checks
- Google Sheets integration is disabled in DEV mode
- Run checks stored in memory only (reset on server restart)
- No Google API credentials needed

### 🎯 Zero External Dependencies
Perfect for development, testing, and learning the codebase without any external service setup.

### Production Deployment

#### Using Docker

1. Build the Docker image:
   ```bash
   docker-compose build
   ```

2. Start the application:
   ```bash
   docker-compose up -d
   ```

3. Access the application at http://localhost:3000

#### Manual Deployment

1. Build the frontend:
   ```bash
   cd frontend
   npm run build
   ```

2. Build the backend:
   ```bash
   cd ../backend
   npm run build
   ```

3. Set production environment variables in `.env`

4. Start the server:
   ```bash
   npm start
   ```

## Configuration

### Environment Variables

See `.env.example` for all available environment variables.

Key variables:
- `DATABASE_URL` - Database connection string
- `SESSION_SECRET` - Secret for session encryption
- `SMTP_*` - Email configuration for magic links
- `RUN_PROVIDER` - `config` or `sheets`
- `GOOGLE_*` - Google Sheets API credentials (if using sheets provider)

### Run Configuration

Configuration is managed using the [Node.js config package](https://www.npmjs.com/package/config). Files are located in `backend/config/`:

- `default.yaml` - Base configuration
- `development.yaml` - Development overrides  
- `production.yaml` - Production overrides
- `custom-environment-variables.yaml` - Environment variable mappings

Configure:
- Superusers (admins who can't be demoted)
- Patrollers without accounts
- Run list (when using config provider)
- Development flags (see below)

### Environment-Specific Configuration

The config package automatically loads environment-specific files based on `NODE_ENV`. Settings merge in order:
1. `default.yaml` (base config)
2. `{NODE_ENV}.yaml` (environment overrides)
3. Environment variables (mapped in `custom-environment-variables.yaml`)

**Development Flags:**
```yaml
enableLoginWithoutPassword: true  # Enable POST /auth/dev-login endpoint
disableMagicLink: true             # Skip sending emails, return tokens in response
```

These flags are useful for local development without SMTP configuration.

## Run Providers

### Config Provider (Development)

Uses runs defined in `config.yaml`. Fast and simple for development.

### Sheets Provider (Production)

Integrates with Google Sheets and Google Drive for dynamic run lists and persistent storage.

**How it works:**
- **Source Spreadsheet** (GOOGLE_SHEETS_ID): Contains run names - used as read-only reference
  - Must have columns named "Section" and "Run Name" (case-insensitive)
  - First sheet in the workbook is read
  - Header row is automatically detected
- **Daily Spreadsheets**: A new spreadsheet is automatically created each day in a specified Drive folder (GOOGLE_DRIVE_FOLDER_ID)
- Each daily spreadsheet is named `YYYY-MM-DD` and contains that day's run checks

**Source Spreadsheet Format:**
```
| Section        | Run Name         | (other columns optional) |
|----------------|------------------|--------------------------|
| Bear Cub       | Grizzly (Upper)  | ...                      |
| Bear Cub       | Grizzly (Lower)  | ...                      |
| Lower Mountain | Exhibition       | ...                      |
```

Setup:
1. Create a Google Cloud project
2. Enable Google Sheets API and Google Drive API
3. Create a service account and download credentials
4. Create a Google Drive folder for daily spreadsheets
5. Share both the source spreadsheet AND the Drive folder with the service account email
6. Configure environment variables:
   - `GOOGLE_SHEETS_ID`: ID of your source spreadsheet (for run names)
   - `GOOGLE_DRIVE_FOLDER_ID`: ID of the folder where daily spreadsheets will be created
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`: Service account email
   - `GOOGLE_PRIVATE_KEY`: Private key from service account credentials

## User Management

### Superusers

Defined in `config.yaml`, superusers:
- Always have admin access
- Cannot be demoted or deleted
- Are marked with a badge in the admin panel

### Regular Users

- Created by admins via the admin panel
- Receive a welcome email with login link
- Can be promoted to admin by other admins
- Can be deleted by admins

## License

Proprietary - Bear Valley Ski Patrol

## Support

For issues or questions, contact the development team.
