# Bear Valley Run Checks - Requirements

**Last Updated:** 2026-01-19

## Core Requirements

### Data Model
- **Run Check:** Run Name, Check Time, Patroller Name
- **Run:** Name, Section (5 sections total, ~100 runs)
- **User:** Email, Name, Admin Status

### Authentication
- Email-only magic link authentication
- No passwords
- Session management
- Admin role for user management

### Run Check Recording
- Tap runs to add to cart
- Batch submit multiple runs
- Default: current time, current user
- Editable: time (up to +15 min future), patroller
- Real-time sync across all connected clients

### UI Views

#### 1. Run Checks Tab (Main)
- 5 collapsible sections (default collapsed)
- Runs sorted by last check time (oldest first)
- Show: run name, time since last check
- Color coding:
  - RED: Never checked today OR oldest 3+ runs
  - YELLOW: Checked but > 60 minutes ago
  - GREEN: Checked ≤ 60 minutes ago
- Cart system: tap to add, banner at bottom, submit button

#### 2. History by Section Tab
- Shows all checks today grouped by section
- Display: run name, check time, patroller

#### 3. Checks by Patroller Tab
- Shows all checks today grouped by patroller
- Display: run name, section, check time

#### 4. Admin Panel (Admins only)
- List all users
- Add new user (email, name) → sends welcome magic link
- Delete user
- Toggle admin status

### Data Storage
- **Users & Sessions:** SQLite + Prisma
- **Run Checks:** Google Sheets (one sheet per day)
- **Runs:** Google Sheets template (read once on startup)
- **Performance:** In-memory cache for today's checks

### Technical Constraints
- Mobile-first (browser-based, no native app)
- Lightweight frontend (CDN libraries)
- Real-time updates required
- No offline mode needed
- Hosted: Docker + Cloudflare Tunnel on VPS

### Integrations
- **Email:** SMTP2go for magic links
- **Storage:** Google Sheets API

---

## Non-Requirements

- ❌ Password authentication
- ❌ Offline support
- ❌ Native mobile apps
- ❌ Historical data beyond current day (access via Google Sheets)
- ❌ Additional run check data (conditions, hazards, etc.)
- ❌ Edit/delete submitted run checks
- ❌ Run management in-app (managed via Google Sheets template)

---

## User Flows

### Login Flow
1. Enter email
2. Receive magic link email
3. Click link → logged in

### Record Run Checks Flow
1. View run list (color-coded)
2. Tap runs to add to cart
3. Tap submit in cart banner
4. Review/edit time and patroller on confirm page
5. Submit → checks saved, real-time broadcast to all users

### Admin User Management Flow
1. Navigate to Admin tab
2. View user list
3. Add user: enter email/name → user created, welcome email sent
4. Delete user: click delete → confirm → user removed
5. Toggle admin: click checkbox → status updated

---

## Color Coding Logic

For each section:
1. Sort runs by time since last check (oldest first)
2. Select oldest until count > 3 → RED
3. Any remaining with last check > 60 min → YELLOW
4. Any with last check ≤ 60 min → GREEN
5. Never checked today → RED

---

## Performance Requirements

- In-memory cache for instant run check lookups
- Real-time updates via Socket.io (no polling)
- Lightweight frontend for mobile devices
- Fast page loads (CDN libraries, minimal bundled JS)

---

## Security Requirements

- Session-based authentication
- Admin-only routes protected by middleware
- Time validation: check time must be ≤ now + 15 min
- Magic links expire after 15 minutes
- HTTPS only (via Cloudflare)

---

## Scale

- **Users:** ~100 concurrent users
- **Runs:** ~100 runs across 5 sections
- **Checks:** Estimated 500-1000 checks per day
- **Real-time:** ~10 users viewing simultaneously during peak

