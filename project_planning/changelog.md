# Bear Valley Run Checks - Planning Changelog

Track all changes to project planning documents.

---

## 2026-01-19 - Initial Planning Documents Created

### Created
- `outline.md` - Complete project outline with architecture, components, and implementation details
- `requirements.md` - Concise requirements summary
- `decisions.md` - Technical decision log with rationale
- `changelog.md` - This file

### Key Decisions Made
1. Tech stack finalized: Node.js + TypeScript, SQLite + Prisma, Socket.io, Alpine.js
2. Architecture: Google Sheets storage with in-memory cache
3. UI: Three-tab layout with cart system for batch submissions
4. Auth: Magic link email-only authentication
5. Color coding: Red/yellow/green bucketing based on last check time

### Next Steps
- Review and iterate on requirements
- Begin implementation when ready

---

## 2026-01-19 (Later) - Configuration & Flexibility Updates

### Added
1. **Run Provider Pattern**
   - Abstract `IRunProvider` interface for pluggable run data sources
   - `ConfigRunProvider` - loads runs from config.yaml (for development)
   - `SheetsRunProvider` - loads runs from Google Sheets (for production)
   - Environment variable `RUN_PROVIDER` to switch between providers

2. **Superuser Protection**
   - `superusers` array in config.yaml
   - Superusers cannot have admin status removed
   - Superusers cannot be deleted
   - UI shows superuser indicator and disables controls

3. **Non-App Patrollers**
   - `patrollers` array in config.yaml
   - Names for patrollers who don't use the app
   - Included in patroller autocomplete alongside app users

4. **Searchable Patroller Autocomplete**
   - Replaced simple dropdown with searchable autocomplete input
   - Case-insensitive matching
   - Matches on start of any word in name
   - Client-side filtering for performance

5. **New API Endpoint**
   - `GET /api/patrollers` - returns all patroller names (users + config)

### Changed
- Updated project structure to include `providers/` directory
- Modified `GET /api/users` to include `isSuperuser` flag
- Updated `PATCH /api/users/:id/admin` to reject superuser demotion (403)
- Enhanced admin panel UI to show superuser status
- Updated environment variables to include `RUN_PROVIDER` and `CONFIG_PATH`

### Rationale
- **Run Provider:** Enables faster development without Google Sheets setup, cleaner separation of concerns
- **Superusers:** Prevents accidental lockout of critical admin accounts
- **Non-App Patrollers:** Reflects real-world usage where some patrollers don't have accounts
- **Searchable Autocomplete:** Better UX for selecting from 100+ patrollers on mobile

### Impact
- **Files Added:** `providers/runProvider.ts`, `providers/configRunProvider.ts`, `providers/sheetsRunProvider.ts`, `config.yaml`
- **Files Modified:** API routes, admin panel component, confirm page component
- **Configuration:** New config.yaml required for development

---

## Template for Future Entries

```markdown
## YYYY-MM-DD - Brief Description

### Added
- List new features/decisions

### Changed
- List modifications to existing plans

### Removed
- List removed features/decisions

### Rationale
- Explain why changes were made

### Impact
- Note any files or components affected
```

