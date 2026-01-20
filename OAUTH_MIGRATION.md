# OAuth Migration Summary

## Overview
Successfully migrated from Google Service Account authentication to OAuth 2.0 for Google Drive and Sheets integration.

## Changes Made

### Backend

#### New Files Created:
1. **`backend/src/routes/google.ts`** - OAuth routes
   - `GET /api/google/oauth/authorize` - Start OAuth flow
   - `GET /api/google/oauth/callback` - Handle OAuth callback
   - `POST /api/google/oauth/folder` - Update selected folder
   - `POST /api/google/oauth/refresh` - Manually refresh token
   - `GET /api/google/oauth/status` - Check OAuth status
   - `DELETE /api/google/oauth/disconnect` - Remove OAuth connection

2. **`backend/src/services/googleOAuth.ts`** - Token management service
   - `getActiveOAuth()` - Get active OAuth configuration
   - `refreshTokenIfNeeded()` - Automatic token refresh
   - `testOAuthToken()` - Validate token with API call
   - `getAuthenticatedSheetsClient()` - Get configured Sheets/Drive clients
   - `validateOAuthToken()` - Hourly validation check
   - `startOAuthValidationScheduler()` - Background scheduler

#### Modified Files:
3. **`backend/src/services/googleSheets.ts`**
   - Removed service account initialization
   - Updated to use OAuth clients from `googleOAuth.ts`
   - All API calls now use authenticated OAuth clients

4. **`backend/src/index.ts`**
   - Added Google routes registration
   - Started OAuth validation scheduler

5. **`backend/src/config/config.ts`**
   - Removed service account fields from `AppConfig` interface
   - Removed loading of Google service account env vars

6. **`backend/.env.example`**
   - Replaced service account vars with OAuth credentials:
     - `GOOGLE_CLIENT_ID`
     - `GOOGLE_CLIENT_SECRET`

7. **`backend/config/default.yaml`**
   - Removed Google service account fields

8. **`backend/config/custom-environment-variables.yaml`**
   - Removed service account environment variable mappings

### Frontend

#### Modified Files:
9. **`frontend/public/index.html`**
   - Added Google APIs and Picker scripts

10. **`frontend/src/app.ts`**
    - Added `googleOAuthStatus` state
    - Added `googlePickerLoaded` flag
    - Added OAuth status loading in `loadData()`
    - Added cart submission validation (blocks if token stale)
    - Added OAuth methods:
      - `linkGoogleDrive()` - Redirect to OAuth flow
      - `refreshGoogleToken()` - Manually refresh connection
      - `disconnectGoogle()` - Remove OAuth connection
      - `openGooglePicker()` - Select Drive folder

11. **`frontend/src/services/api.ts`**
    - Added Google OAuth API methods:
      - `getGoogleOAuthStatus()`
      - `refreshGoogleToken()`
      - `disconnectGoogle()`
      - `updateGoogleFolder()`

12. **`frontend/src/index.ts`**
    - Added Google Drive OAuth section to Admin tab
      - Shows linked user, Google account, folder, last tested time
      - Warning banners for stale/expired tokens
      - Action buttons: Select Folder, Refresh, Disconnect
    - Added OAuth warning banner on cart/confirm page

13. **`frontend/src/styles/main.css`**
    - Added OAuth status styling
    - Added warning/error banner styles

### Database
The `GoogleOAuth` table already existed in the schema with all required fields:
- `userId`, `accessToken`, `refreshToken`, `tokenExpiresAt`
- `googleEmail`, `googleDriveFolderId`, `googleSheetsId`
- `lastTestedAt`, `isActive`

### Documentation
14. **`GOOGLE_OAUTH_SETUP.md`** - Complete OAuth setup guide
    - Google Cloud Console setup instructions
    - API enablement steps
    - OAuth consent screen configuration
    - Credential creation walkthrough
    - Environment variable setup
    - Troubleshooting guide

## Key Features

### Automatic Token Management
- Tokens automatically refreshed before expiration
- Hourly validation checks ensure connection health
- Failed validations mark OAuth as inactive

### Admin UI
- Link Google Drive with one click
- Select folder using Google Picker
- View connection status and last test time
- Manual refresh and disconnect options
- Clear warnings when connection is stale

### Cart Validation
- Blocks submissions if token not tested in past hour
- Shows clear warning banner on confirm page
- Directs users to refresh in Admin tab

### Security
- Only superusers/admins can manage OAuth
- Tokens stored securely in database
- Minimum required permissions requested
- CSRF protection on OAuth flow

## Migration from Service Account

### Removed:
- All service account configuration fields
- Environment variables: `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`
- Config values: `googleSheetsId`, `googleDriveFolderId` (now in database via OAuth)

### Required:
- New environment variables: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- Manual OAuth linking in Admin panel
- Folder selection via UI instead of config

## Testing Checklist

- [ ] Backend compiles without errors
- [ ] OAuth authorization flow works
- [ ] Folder selection via Google Picker works
- [ ] Token refresh works (manual and automatic)
- [ ] Hourly validation scheduler runs
- [ ] Cart page blocks submission when token is stale
- [ ] Admin UI shows OAuth status correctly
- [ ] Disconnect and re-link works
- [ ] Daily spreadsheet creation works with OAuth
- [ ] Run check submission works end-to-end

## Next Steps

1. **Set up Google Cloud Console**
   - Follow `GOOGLE_OAUTH_SETUP.md`
   - Create OAuth credentials
   - Enable required APIs

2. **Update Environment**
   - Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to `.env`
   - Restart backend

3. **Link Google Drive**
   - Log in as superuser/admin
   - Go to Admin tab
   - Click "Link Google Drive"
   - Complete OAuth flow
   - Select folder for daily spreadsheets

4. **Test Integration**
   - Submit run checks
   - Verify daily spreadsheet is created
   - Check hourly validation in logs
   - Test manual token refresh
