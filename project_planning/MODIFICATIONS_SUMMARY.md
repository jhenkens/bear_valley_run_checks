# Modifications Summary

**Date:** 2026-01-19

This document summarizes the modifications made to the original project plan.

---

## Changes Overview

### 1. Run Provider Pattern ✨

**What:** Abstract the source of run data (name + section) via a provider interface.

**Why:** Separate development workflow from production configuration.

**Implementation:**
- **Development:** Load runs from `config.yaml` using `ConfigRunProvider`
- **Production:** Load runs from Google Sheets using `SheetsRunProvider`
- Switch via `RUN_PROVIDER` environment variable (`config` or `sheets`)

**Benefits:**
- No Google Sheets setup required for local development
- Faster iteration with fixture data
- Easy testing

---

### 2. Superuser Protection 🛡️

**What:** Protect certain admin accounts from being demoted or deleted.

**Why:** Prevent accidental lockout of critical accounts (e.g., mountain managers).

**Implementation:**
- Define superuser emails in `config.yaml`
- Backend validates: cannot remove admin status or delete superusers
- Frontend shows indicator and disables controls for superusers

**Example:**
```yaml
superusers:
  - admin@bearvalley.com
  - supervisor@bearvalley.com
```

---

### 3. Non-App Patrollers 👥

**What:** Define patroller names for people who don't use the app.

**Why:** Some patrollers (seasonal workers, volunteers) don't have accounts, but experienced patrollers can log checks on their behalf.

**Implementation:**
- Define names in `config.yaml`
- Combine with app user names for patroller autocomplete
- No authentication tied to these names

**Example:**
```yaml
patrollers:
  - John Doe (Seasonal)
  - Jane Smith (Volunteer)
```

---

### 4. Searchable Patroller Autocomplete 🔍

**What:** Replace simple dropdown with searchable autocomplete input.

**Why:** Better UX for selecting from 100+ patrollers on mobile devices.

**Features:**
- Type to filter (case-insensitive)
- Matches on start of any word in name
  - Example: "joh" matches "John Doe" and "Bob Johnson"
- Client-side filtering (fast for 100 names)
- Shows filtered results in dropdown

---

## New Files

```
backend/
├── config.yaml                      # Development configuration
├── providers/
│   ├── runProvider.ts               # Abstract interface
│   ├── configRunProvider.ts         # config.yaml implementation
│   └── sheetsRunProvider.ts         # Google Sheets implementation
└── routes/
    └── patrollers.ts                # GET /api/patrollers endpoint
```

---

## Modified Components

### Backend

**API Routes:**
- `GET /api/runs` - Now uses run provider (not hardcoded to Sheets)
- `GET /api/users` - Returns `isSuperuser` flag for each user
- `PATCH /api/users/:id/admin` - Rejects demotion of superusers (403 error)
- `GET /api/patrollers` - New endpoint returning all patroller names

**Services:**
- Google Sheets Service no longer loads run template (delegated to provider)

### Frontend

**Admin Panel:**
- Show superuser indicator (badge/icon)
- Disable admin checkbox for superusers
- Disable delete button for superusers
- Tooltip: "Superusers cannot be demoted"

**Confirm Page:**
- Replace patroller dropdown with searchable autocomplete
- Client-side filtering logic
- Display filtered results dynamically

---

## New Environment Variables

```bash
# Run Provider
RUN_PROVIDER=config          # 'config' or 'sheets'
CONFIG_PATH=./config.yaml    # Path to config file
```

---

## Configuration File Structure

```yaml
# config.yaml

runProvider: config  # or 'sheets'

runs:
  - name: Cub
    section: Bear Cub
  - name: Grizzly
    section: Bear Cub
  # ... more runs

superusers:
  - admin@bearvalley.com
  - supervisor@bearvalley.com

patrollers:
  - John Doe (Seasonal)
  - Jane Smith (Volunteer)
```

See `config.example.yaml` for full example.

---

## Development Workflow Changes

### Before (Original Plan)
1. Set up Google Sheets API credentials
2. Create template sheet with runs
3. Share sheet with service account
4. Configure `TEMPLATE_SHEET_ID`

### After (With Modifications)
1. Copy `config.example.yaml` to `backend/config.yaml`
2. Customize runs, superusers, patrollers
3. Set `RUN_PROVIDER=config`
4. Start development (no Google Sheets needed)

**For production:**
- Set `RUN_PROVIDER=sheets`
- Configure Google Sheets credentials and template
- Superusers and non-app patrollers still come from config.yaml

---

## Impact on Planning Documents

All planning documents have been updated:

1. **outline.md** - Added provider pattern, config.yaml structure, updated components
2. **requirements.md** - Added new features to requirements
3. **decisions.md** - Documented rationale for all changes
4. **changelog.md** - Logged all modifications
5. **config.example.yaml** - Example configuration file

---

## Questions?

Review the updated files:
- `outline.md` - Full technical details
- `decisions.md` - Rationale for each decision
- `config.example.yaml` - Example configuration

