# Bear Valley Run Checks - Project Outline

**Last Updated:** 2026-01-19

## Project Overview

A mobile-first web application for Bear Valley ski patrol to track which runs have been recently checked. The app enables real-time coordination among ~100 patrollers across ~100 runs organized into 5 sections.

---

## Tech Stack

### Backend
- **Runtime:** Node.js + TypeScript
- **Framework:** Express
- **Database:** SQLite + Prisma ORM
- **Real-time:** Socket.io
- **Email:** Nodemailer + SMTP2go
- **Storage:** Google Sheets API (googleapis)

### Frontend
- **Framework:** Alpine.js (CDN)
- **Build:** Webpack + TypeScript
- **Styling:** Mobile-first CSS

### Deployment
- Docker + Cloudflare Tunnel
- VPS hosting

---

## Project Structure

```
bear-valley-run-checks/
├── backend/
│   ├── src/
│   │   ├── index.ts                 # Express app entry point
│   │   ├── config/
│   │   │   └── config.ts            # Environment config
│   │   ├── auth/
│   │   │   ├── magicLink.ts         # Magic link generation/validation
│   │   │   ├── middleware.ts        # Auth middleware
│   │   │   └── session.ts           # Session management
│   │   ├── routes/
│   │   │   ├── auth.ts              # Login/logout routes
│   │   │   ├── runchecks.ts         # Run check CRUD
│   │   │   ├── users.ts             # User management (admin)
│   │   │   └── patrollers.ts        # Get patroller names
│   │   ├── services/
│   │   │   ├── googleSheets.ts      # Sheets API integration (provider)
│   │   │   ├── email.ts             # Nodemailer + SMTP2go
│   │   │   └── runCheckCache.ts     # In-memory cache for today's checks
│   │   ├── providers/
│   │   │   ├── runProvider.ts       # Abstract run provider interface
│   │   │   ├── configRunProvider.ts # config.yaml provider
│   │   │   └── sheetsRunProvider.ts # Google Sheets provider
│   │   ├── socket/
│   │   │   └── runCheckSocket.ts    # Socket.io handlers
│   │   └── prisma/
│   │       └── schema.prisma        # Database schema
│   ├── config.yaml                  # Dev configuration
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── index.ts                 # Main entry point
│   │   ├── components/
│   │   │   ├── runChecksTab.ts      # Run checks with cart
│   │   │   ├── historyTab.ts        # History by section
│   │   │   ├── patrollerTab.ts      # Checks by patroller
│   │   │   └── adminPanel.ts        # Admin user management
│   │   ├── services/
│   │   │   ├── api.ts               # API client
│   │   │   └── socket.ts            # Socket.io client
│   │   ├── utils/
│   │   │   └── colorLogic.ts        # Red/yellow/green bucketing
│   │   └── styles/
│   │       └── main.css             # Mobile-first CSS
│   ├── public/
│   │   └── index.html               # Alpine.js + CDN imports
│   ├── webpack.config.js
│   ├── package.json
│   └── tsconfig.json
├── docker-compose.yml
├── Dockerfile
└── .env.example
```

---

## Database Schema (Prisma)

```prisma
// schema.prisma

model User {
  id        String   @id @default(uuid())
  email     String   @unique
  name      String
  isAdmin   Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model MagicLink {
  id        String   @id @default(uuid())
  email     String
  token     String   @unique
  expiresAt DateTime
  createdAt DateTime @default(now())
}

model Session {
  id        String   @id
  userId    String
  expiresAt DateTime
  createdAt DateTime @default(now())
}
```

**Note:** Run checks are NOT stored in SQLite - they live only in Google Sheets + in-memory cache.

---

## Configuration (config.yaml)

Development configuration file for runs, superusers, and non-app patrollers.

```yaml
# Run provider configuration
runProvider: config  # 'config' or 'sheets'

# Runs (when runProvider = 'config')
runs:
  - name: Cub
    section: Bear Cub
  - name: Grizzly
    section: Bear Cub
  - name: Kodiak
    section: Lower Mountain
  # ... more runs

# Superusers (cannot be removed as admins)
superusers:
  - admin@bearvalley.com
  - supervisor@bearvalley.com

# Non-app patrollers (for others to log checks on behalf of)
patrollers:
  - John Doe (Non-App)
  - Jane Smith (Non-App)
  - Bob Johnson (Non-App)
```

**Usage:**
- `runProvider`: Switch between config and Google Sheets for run data
- `superusers`: Email addresses that cannot have admin status removed
- `patrollers`: Names that appear in patroller dropdown but don't have app accounts

---

## Google Sheets Structure

### Template Sheet
Defines all runs and their sections. Read once on startup.

**Format:**
```
Run Name | Section
---------|--------
Cub      | Bear Cub
...
```

### Daily Sheets
One sheet created per day (YYYY-MM-DD format). Each run check appends a row.

**Format:**
```
Run Name | Section | Check Time          | Patroller
---------|---------|---------------------|----------
Cub      | Bear Cub| 2026-01-19 09:15:00 | John Doe
...
```

---

## Backend Components

### 1. Authentication System

**Magic Link Flow:**
1. User enters email → POST `/auth/login`
2. Backend generates token, stores in `MagicLink` table with 15-min expiry
3. Email sent with link: `https://app.url/auth/verify?token=xxx`
4. User clicks → GET `/auth/verify?token=xxx`
5. Token validated → Session created → Redirect to app

**API Endpoints:**
- `POST /auth/login` - Send magic link email
- `GET /auth/verify?token=xxx` - Validate token, create session, redirect
- `GET /auth/logout` - Destroy session
- `GET /auth/me` - Get current user info

**Middleware:**
- `requireAuth` - Ensures user is logged in
- `requireAdmin` - Ensures user is admin

### 2. Run Provider Pattern

**Abstract Provider Interface:**
```typescript
interface IRunProvider {
  initialize(): Promise<void>
  getRuns(): Run[]
}
```

**Implementations:**

**ConfigRunProvider** (for development):
- Loads runs from `config.yaml`
- Simple, fast, no external dependencies

**SheetsRunProvider** (for production):
- Loads runs from Google Sheets template
- Allows non-technical users to manage run list

**Configuration:**
Specify provider in environment:
```bash
RUN_PROVIDER=config  # or 'sheets'
```

### 3. Google Sheets Service

**Responsibilities:**
- Check if daily sheet exists, create if needed
- Parse daily sheet on startup → populate cache
- Append new run checks to daily sheet
- Keep in-memory cache in sync

**Interface:**
```typescript
class GoogleSheetsService {
  async initialize(): Promise<void>
  async getTodayChecks(): Promise<RunCheck[]>  // From cache
  async addRunCheck(check: RunCheck): Promise<void>  // Append to sheet + cache
}
```

**Note:** Run list loading now handled by separate run provider.

### 4. In-Memory Cache

```typescript
interface Run {
  name: string;
  section: string;
}

interface RunCheck {
  runName: string;
  section: string;
  checkTime: Date;
  patroller: string;
}

class RunCheckCache {
  private runs: Run[] = [];
  private todayChecks: RunCheck[] = [];

  // Reload from sheet daily at midnight
  // Update on new check
}
```

### 5. Patroller Names Service

**Responsibilities:**
- Combine app users + config-based patrollers
- Provide full list for autocomplete

**Sources:**
1. All users from database (User table)
2. Non-app patrollers from `config.yaml`

**Interface:**
```typescript
class PatrollerService {
  getPatrollerNames(): string[]  // Returns sorted array of all patroller names
}
```

### 6. API Routes

**Run Checks:**
- `GET /api/runs` - Get all runs from run provider
- `GET /api/runchecks/today` - Get today's checks (from cache)
- `POST /api/runchecks` - Submit run check(s)
  - Body: `{ checks: [{ runName, checkTime, patroller }] }`
  - Validates: checkTime within [-now, +15min]
  - Appends to sheet, updates cache, emits socket event

**Patrollers:**
- `GET /api/patrollers` - Get all patroller names (app users + config patrollers)

**User Management (Admin only):**
- `GET /api/users` - List all users (includes `isSuperuser` flag)
- `POST /api/users` - Create user
  - Body: `{ email, name }`
  - Sends welcome magic link
- `DELETE /api/users/:id` - Delete user
- `PATCH /api/users/:id/admin` - Toggle admin status
  - Body: `{ isAdmin: boolean }`
  - Validates: Cannot remove admin from superusers
  - Returns 403 if attempting to demote superuser

### 7. Socket.io Events

**Server → All Clients:**
```typescript
socket.emit('runcheck:new', {
  runName: string,
  section: string,
  checkTime: Date,
  patroller: string
})
```

Clients listen for this event and update their UI in real-time.

### 8. Email Service

**Templates:**
- Magic link email: "Click here to log in to Bear Valley Run Checks: [link]"
- Welcome email (new user): "You've been added to Bear Valley Run Checks: [magic link]"

**Configuration:**
- SMTP2go API key
- Sender: `noreply@bearvalley.com` (or similar)

---

## Frontend Components

### Layout Structure

```
┌─────────────────────────────┐
│  Header (User name, Logout) │
├─────────────────────────────┤
│  Tab Bar:                   │
│  [Run Checks] [History]     │
│  [Patrollers] [Admin*]      │
├─────────────────────────────┤
│                             │
│  Tab Content Area           │
│                             │
│                             │
├─────────────────────────────┤
│  Cart Banner (when items)   │
│  [3 runs selected] [Submit] │
└─────────────────────────────┘

* Admin tab only visible to admins
```

### 1. Run Checks Tab (Main View)

**Features:**
- 5 collapsible sections (default: collapsed)
- Each section lists runs sorted by last check time (oldest first)
- Each run displays:
  - Run name
  - Time since last check ("45 mins ago" or "Never Checked")
  - Color indicator (red/yellow/green dot or background)

**Color Logic:**
1. Sort runs by time since last check (oldest first)
2. Count from oldest until total > 3 → Mark RED
3. Any remaining > 60 mins → Mark YELLOW
4. Any ≤ 60 mins → Mark GREEN

**Interaction:**
- Tap run → Adds to cart (visual feedback: checkmark or highlight)
- Tap again → Removes from cart
- Cart banner appears when 1+ items selected
- Submit button → Navigate to Confirm Page

**Real-time Updates:**
- Socket.io listener updates run list when new checks arrive
- Recalculates colors and times

### 2. Confirm Page (Cart Checkout)

**Features:**
- Lists all selected runs
- Form fields:
  - **Patroller:** Searchable autocomplete input
    - Type to filter patroller names (case-insensitive)
    - Matches on the start of any word in the name
    - Example: "joh" matches "John Doe" and "Bob Johnson"
    - Includes both app users and config-based patrollers
    - Default to current user
  - **Check Time:** Time picker, default to "now", range: [now, +15min]
- Submit button → POST to `/api/runchecks`
- Success → Clear cart, return to Run Checks tab, show toast

**Autocomplete Implementation:**
```typescript
function filterPatrollers(query: string, patrollers: string[]): string[] {
  const lower = query.toLowerCase();
  return patrollers.filter(name =>
    name.toLowerCase().split(' ').some(word => word.startsWith(lower))
  );
}
```

### 3. History by Section Tab

**Features:**
- 5 sections (collapsible or always expanded)
- For each run in the section, show all checks today:
  - Run Name
  - Check Time (formatted: "9:15 AM")
  - Patroller
- Sorted by check time (newest first)

### 4. Checks by Patroller Tab

**Features:**
- List all patrollers who checked runs today
- Under each patroller, show their checks:
  - Run Name
  - Section
  - Check Time
- Sorted by check time (newest first)

### 5. Admin Panel

**Features:**
- User list table:
  - Email
  - Name
  - Admin status (checkbox, disabled for superusers)
  - Delete button (disabled for superusers)
  - Superuser indicator (badge/icon)
- "Add User" button → Modal:
  - Email input
  - Name input
  - Submit → POST `/api/users`
- Toggle admin checkbox → PATCH `/api/users/:id/admin`
  - Disabled for superusers (defined in config.yaml)
  - Shows tooltip: "Superusers cannot be demoted"
- Delete button → Confirm dialog → DELETE `/api/users/:id`
  - Disabled for superusers

---

## Color Logic Algorithm

```typescript
interface RunWithTime {
  run: Run;
  minutesSince: number;  // Infinity if never checked
}

function colorCodeRuns(runs: Run[], checks: RunCheck[]): RunWithColor[] {
  const now = Date.now();

  // Calculate time since last check for each run
  const runTimes: RunWithTime[] = runs.map(run => {
    const lastCheck = checks.find(c => c.runName === run.name);
    return {
      run,
      minutesSince: lastCheck
        ? (now - lastCheck.checkTime.getTime()) / 60000
        : Infinity
    };
  });

  // Sort oldest first (Infinity will be at the end)
  runTimes.sort((a, b) => {
    if (a.minutesSince === Infinity && b.minutesSince === Infinity) return 0;
    if (a.minutesSince === Infinity) return -1;
    if (b.minutesSince === Infinity) return 1;
    return b.minutesSince - a.minutesSince;
  });

  // Apply bucketing logic
  let redCount = 0;
  return runTimes.map(rt => {
    if (rt.minutesSince === Infinity) {
      // Never checked today
      return { ...rt, color: 'red' };
    } else if (redCount < 3) {
      // First 3 (or more if tied) oldest
      redCount++;
      return { ...rt, color: 'red' };
    } else if (rt.minutesSince > 60) {
      // Older than 1 hour
      return { ...rt, color: 'yellow' };
    } else {
      // Within last hour
      return { ...rt, color: 'green' };
    }
  });
}
```

---

## Configuration & Environment

### Environment Variables

```bash
# Database
DATABASE_URL=file:./dev.db

# Session
SESSION_SECRET=<random-secret>

# Email (SMTP2go)
SMTP2GO_API_KEY=<api-key>
SMTP2GO_SENDER=noreply@bearvalley.com

# Google Sheets
GOOGLE_SHEETS_CREDENTIALS=./credentials.json
TEMPLATE_SHEET_ID=<google-sheet-id>  # Only needed if RUN_PROVIDER=sheets
STORAGE_FOLDER_ID=<google-drive-folder-id>  # Where daily sheets are created

# Run Provider
RUN_PROVIDER=config  # 'config' or 'sheets'
CONFIG_PATH=./config.yaml  # Path to config.yaml

# App
APP_URL=https://runchecks.bearvalley.com
PORT=3000
NODE_ENV=production
```

### Google Sheets API Setup

1. Create service account in Google Cloud Console
2. Download credentials JSON
3. Share template sheet with service account email
4. Share storage folder with service account email (write access)

---

## Deployment

### Docker Setup

**Dockerfile:**
- Multi-stage build (build TypeScript → production image)
- Include Prisma CLI for migrations
- SQLite database volume mounted

**docker-compose.yml:**
- Backend service
- Volume for SQLite database
- Environment variables
- Cloudflare Tunnel sidecar (optional, or external)

### Cloudflare Tunnel

- Tunnel configured to route `runchecks.bearvalley.com` → container:3000
- DNS managed in Cloudflare

---

## Development Workflow

### Initial Setup
1. Clone repo
2. `npm install` in both backend/ and frontend/
3. Copy `.env.example` → `.env`, fill in values
4. Set up Google Sheets API credentials
5. `npx prisma migrate dev` - Initialize database
6. Create first admin user manually in DB
7. `npm run dev` - Start backend + frontend dev servers

### Daily Development
1. Backend: `npm run dev` (ts-node-dev with auto-reload)
2. Frontend: `npm run dev` (webpack dev server)
3. Access: `http://localhost:8080`

### Testing
- Unit tests for color logic, auth, cache
- Integration tests for API routes
- Manual testing on mobile devices

---

## Key Features Summary

### Core Functionality
- ✅ Email-only magic link authentication
- ✅ 100 runs across 5 sections
- ✅ Record run checks (who, when, where)
- ✅ Edit time (up to +15 min future) and patroller
- ✅ Real-time updates via Socket.io
- ✅ Cart system for batch check submissions
- ✅ Searchable autocomplete for patroller selection

### UI Features
- ✅ Color-coded runs (red/yellow/green) based on last check
- ✅ 3 tabs: Run Checks, History by Section, Checks by Patroller
- ✅ Mobile-first, touch-friendly interface
- ✅ Collapsible sections

### Admin Features
- ✅ User management (CRUD)
- ✅ Admin role management
- ✅ Superuser protection (cannot be demoted/deleted)
- ✅ Send welcome emails to new users

### Data Management
- ✅ Google Sheets storage (one sheet per day)
- ✅ In-memory cache for performance
- ✅ Pluggable run provider (config.yaml or Google Sheets)
- ✅ Non-app patroller names (for proxy logging)
- ✅ Config-based superusers

---

## Open Questions / Future Enhancements

- [ ] Should sections have custom sort order, or alphabetical?
- [ ] Add ability to edit/delete run checks after submission?
- [ ] Add notifications for runs that haven't been checked in X hours?
- [ ] Export daily reports via email?
- [ ] Mobile app (native) version?
- [ ] Dark mode?

---

## Next Steps

1. Initialize project structure
2. Set up Prisma schema and migrations
3. Implement authentication system
4. Build Google Sheets integration
5. Create API routes
6. Implement Socket.io real-time updates
7. Build frontend components
8. Test and deploy

