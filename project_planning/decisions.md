# Bear Valley Run Checks - Decision Log

**Purpose:** Track key technical decisions and design changes made during planning and development.

---

## 2026-01-19 - Initial Planning

### Tech Stack Decisions

**Database: SQLite + Prisma**
- **Why:** Simple, file-based, no separate DB server needed, perfect for ~100 users
- **Alternatives considered:** PostgreSQL (heavier), MongoDB (overkill)
- **Trade-offs:** SQLite has limitations on concurrent writes, but we're only writing user/session data, not run checks

**Real-time: Socket.io**
- **Why:** Well-established, handles reconnection, two-way communication support
- **Alternatives considered:** Server-Sent Events (one-way only)
- **Trade-offs:** Slightly heavier than SSE, but better feature set

**Frontend: Alpine.js + Vanilla TypeScript**
- **Why:** Lightweight, CDN-hosted, minimal bundle size, good for mobile
- **Alternatives considered:** Vue 3, React (heavier), Svelte (requires build)
- **Trade-offs:** Less ecosystem/tooling than React/Vue, but sufficient for our needs

**Authentication: Magic Links (Email-only)**
- **Why:** No password management, simpler UX, secure enough for internal tool
- **Alternatives considered:** OAuth (overkill), passwords (more complex)
- **Trade-offs:** Requires working email, slight friction on first login

**User Management: Prisma + Custom Implementation**
- **Why:** Prisma makes DB operations type-safe and simple
- **Alternatives considered:** Lucia (more batteries-included auth)
- **Trade-offs:** More manual implementation, but more control

---

### Architecture Decisions

**Storage: Google Sheets for Run Checks**
- **Why:**
  - Easy manual review/export
  - No additional DB complexity
  - Built-in versioning/history
  - Familiar to non-technical users
- **Alternatives considered:** Store in SQLite, separate time-series DB
- **Trade-offs:**
  - API rate limits (mitigated by in-memory cache)
  - Slower writes (mitigated by async)
  - Less queryable (but we don't need complex queries)

**In-Memory Cache for Today's Checks**
- **Why:** Fast reads, most queries are for "today's data"
- **Alternatives considered:** Query Sheets API on every request
- **Trade-offs:**
  - Memory usage (minimal for ~1000 checks/day)
  - Cache invalidation complexity (handled by reload at midnight + update on write)

**Run Configuration via Google Sheets Template**
- **Why:** Non-developers can update run list without code changes
- **Alternatives considered:** Hardcode in app, admin UI for run management
- **Trade-offs:** Requires app restart to pick up changes (acceptable)

---

### UI/UX Decisions

**Color Coding: Red/Yellow/Green Bucketing**
- **Why:** Visual priority for which runs need attention
- **Logic:**
  - Red = Never checked OR oldest 3+ runs
  - Yellow = Checked but > 60 min ago
  - Green = Checked ≤ 60 min ago
- **Rationale:** Helps team coordinate so high-priority runs get checked first

**Cart System for Batch Submission**
- **Why:** Patrollers often check multiple runs in a route, batch submission is more efficient
- **Alternatives considered:** Submit one at a time
- **Trade-offs:** Slightly more complex UI, but better UX for common use case

**Allow Future Timestamps (+15 min)**
- **Why:** Patrollers can pre-log runs they're about to check while en route
- **Rationale:** Reduces friction, they don't have to remember to log after completing
- **Constraint:** Max 15 min to prevent abuse/errors

**Three Tabs: Run Checks, History, Patrollers**
- **Why:** Different views for different use cases
  - Run Checks: "What needs checking?"
  - History: "What's been checked in this area?"
  - Patrollers: "What has each person done?"
- **Alternatives considered:** Single combined view (too cluttered)

**Default Collapsed Sections**
- **Why:** Mobile screen space is limited, reduces scrolling
- **Rationale:** Patrollers typically focus on one section at a time

---

### Security Decisions

**Session-Based Auth (not JWT)**
- **Why:** Simpler server-side revocation, standard Express session middleware
- **Alternatives considered:** JWT (stateless, but harder to revoke)

**15-Minute Magic Link Expiry**
- **Why:** Balance between security and UX (enough time to check email, not so long that old links are dangerous)

**Admin-Only User Management**
- **Why:** Prevent unauthorized access, maintain control over user list
- **Rationale:** Internal tool with known user base

---

### Deployment Decisions

**Docker + Cloudflare Tunnel**
- **Why:**
  - Docker: Consistent environment, easy deployment
  - Cloudflare Tunnel: Secure external access without exposing ports
- **Alternatives considered:** Direct VPS with nginx reverse proxy
- **Trade-offs:** Slightly more complex setup, but better security and consistency

---

## Open Questions

### To Be Decided

**Section Sort Order**
- Options: Alphabetical, custom order, most-used first
- Decision: TBD (currently alphabetical)

**Error Handling for Google Sheets API Failures**
- Question: What happens if Sheets API is down?
- Options: Graceful degradation, read-only mode, error page
- Decision: TBD

**Session Expiry Duration**
- Question: How long should sessions last?
- Options: 24 hours, 7 days, 30 days
- Decision: TBD (recommend 7 days for balance)

**Mobile Responsive Breakpoints**
- Question: Support tablets/desktop, or only mobile?
- Decision: TBD (currently mobile-first, but may add tablet view)

---

## Future Enhancements (Out of Scope for v1)

- Edit/delete submitted run checks
- Push notifications for unchecked runs
- Dark mode
- Export daily reports via email
- Native mobile apps
- Offline mode
- Additional run check data (conditions, notes, etc.)
- Run management UI (instead of Google Sheets template)

