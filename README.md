# Bear Valley Run Checks

Mobile-first web application for ski patrol to track run checks with real-time updates.

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
   # Edit .env with your configuration
   ```

5. Initialize the database:
   ```bash
   npx prisma migrate dev --name init
   npx prisma generate
   ```

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

Edit `backend/config.yaml` to configure:
- Superusers (admins who can't be demoted)
- Patrollers without accounts
- Run list (when using config provider)

## Run Providers

### Config Provider (Development)

Uses runs defined in `config.yaml`. Fast and simple for development.

### Sheets Provider (Production)

Integrates with Google Sheets for dynamic run lists and persistent storage.

Setup:
1. Create a Google Cloud project
2. Enable Google Sheets API
3. Create a service account
4. Share your spreadsheet with the service account email
5. Configure environment variables with credentials

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
