# Google OAuth Setup Guide

This guide explains how to set up Google OAuth for the Bear Valley Run Checks application to access Google Drive and Sheets.

## Prerequisites

- Google Cloud Console access
- Admin/superuser access to the Bear Valley Run Checks app

## Step 1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Note your project ID

## Step 2: Enable Required APIs

1. Navigate to **APIs & Services** > **Library**
2. Enable the following APIs:
   - **Google Drive API**
   - **Google Sheets API**
   - **Google Picker API**

## Step 3: Configure OAuth Consent Screen

1. Go to **APIs & Services** > **OAuth consent screen**
2. Select **Internal** (if using Google Workspace) or **External**
3. Fill in the required fields:
   - **App name**: Bear Valley Run Checks
   - **User support email**: Your email
   - **Developer contact information**: Your email
4. Click **Save and Continue**
5. On the **Scopes** page, add the following scopes:
   - `https://www.googleapis.com/auth/drive.file`
   - `https://www.googleapis.com/auth/drive.readonly`
   - `https://www.googleapis.com/auth/spreadsheets`
   - `https://www.googleapis.com/auth/userinfo.email`
6. Click **Save and Continue**
7. Review and complete the consent screen setup

## Step 4: Create OAuth 2.0 Credentials

1. Go to **APIs & Services** > **Credentials**
2. Click **Create Credentials** > **OAuth client ID**
3. Select **Web application**
4. Configure:
   - **Name**: Bear Valley Run Checks
   - **Authorized JavaScript origins**: 
     - `https://your-domain.com`
     - `http://localhost:3000` (for development)
   - **Authorized redirect URIs**:
     - `https://your-domain.com/api/google/oauth/callback`
     - `http://localhost:3000/api/google/oauth/callback` (for development)
5. Click **Create**
6. Copy the **Client ID** and **Client Secret**

## Step 5: Configure Environment Variables

Add the following to your `.env` file:

```bash
# Google OAuth
GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="your-client-secret"
```

## Step 6: Link Google Drive in App

1. Start the application
2. Log in as a superuser/admin
3. Navigate to the **Admin** tab
4. Click **Link Google Drive**
5. Authorize the application to access your Google account
6. Use the **Select Folder** button to choose where daily spreadsheets should be stored
7. The connection will be tested hourly automatically

## How It Works

### Token Management

- **Access tokens** expire after 1 hour
- **Refresh tokens** are stored securely and used to automatically get new access tokens
- Tokens are validated hourly to ensure the connection is working
- If a token fails validation, it will be marked inactive and require re-linking

### Daily Spreadsheet Creation

- When run checks are submitted, the app creates a daily spreadsheet in the selected folder
- Spreadsheets are named by date: `YYYY-MM-DD`
- Each spreadsheet has a "Run Checks" tab with columns: Timestamp, Check Time, Section, Run Name, Patroller

### Security

- Only superusers/admins can link Google Drive accounts
- OAuth tokens are stored encrypted in the database
- Tokens are automatically refreshed before expiration
- The app only requests the minimum required permissions

## Troubleshooting

### "Google Drive connection needs refresh"

1. Go to the **Admin** tab
2. Click **Refresh Connection**
3. If that doesn't work, disconnect and re-link your Google account

### "OAuth not configured" error

Make sure:
1. `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set in `.env`
2. The redirect URI in Google Cloud Console matches your `APP_URL`
3. Required APIs are enabled in Google Cloud Console

### Token validation failures

Check the application logs for detailed error messages. Common issues:
- Google API quota exceeded
- Invalid or revoked credentials
- Network connectivity issues
- Changed Google account permissions

## Migration from Service Account

If you previously used a service account:

1. The service account configuration has been removed
2. Remove these environment variables:
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `GOOGLE_PRIVATE_KEY`
   - `GOOGLE_SHEETS_ID` (now selected via UI)
   - `GOOGLE_DRIVE_FOLDER_ID` (now selected via UI)
3. Set up OAuth credentials as described above
4. Link your Google Drive account in the Admin panel
5. Select the same folder that was previously used

## Additional Resources

- [Google OAuth 2.0 Documentation](https://developers.google.com/identity/protocols/oauth2)
- [Google Drive API Documentation](https://developers.google.com/drive/api/guides/about-sdk)
- [Google Sheets API Documentation](https://developers.google.com/sheets/api/guides/concepts)
