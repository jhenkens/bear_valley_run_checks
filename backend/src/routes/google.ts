import { Router, Request } from 'express';
import { google } from 'googleapis';
import { requireAuth, requireAdmin } from '../auth/middleware';
import { prisma } from '../config/database';

// Extend Express Request type
declare module 'express-serve-static-core' {
  interface Request {
    user?: { id: string; email: string; name: string; isAdmin: boolean; isSuperuser: boolean };
  }
}
import { appConfig } from '../config/config';
import { logger } from '../utils/logger';
import { scheduleNextRefresh } from '../services/googleOAuth';

const router = Router();

// OAuth2 client configuration
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${appConfig.appUrl}/api/google/oauth/callback`
);

// Scopes needed for Drive and Sheets
const SCOPES = [
  'https://www.googleapis.com/auth/drive.file', // Only access files created by this app
  'https://www.googleapis.com/auth/userinfo.email',
];

// GET /api/google/oauth/authorize - Start OAuth flow
router.get('/oauth/authorize', requireAuth, requireAdmin, (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // Force consent screen to get refresh token
    state: req.session.id, // CSRF protection
  });

  res.redirect(authUrl);
});

// GET /api/google/oauth/callback - Handle OAuth callback
router.get('/oauth/callback', requireAuth, async (req, res) => {
  const { code, state } = req.query;

  // Verify state matches session ID (CSRF protection)
  if (state !== req.session.id) {
    return res.status(400).send('Invalid state parameter');
  }

  if (!code || typeof code !== 'string') {
    return res.status(400).send('Missing authorization code');
  }

  try {
    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    
    if (!tokens.access_token || !tokens.refresh_token) {
      throw new Error('Missing tokens from Google OAuth');
    }

    // Set credentials to get user info
    oauth2Client.setCredentials(tokens);
    
    // Get user's Google email
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const googleEmail = userInfo.data.email || '';

    // Calculate token expiry
    const expiresAt = new Date();
    if (tokens.expiry_date) {
      expiresAt.setTime(tokens.expiry_date);
    } else {
      expiresAt.setTime(Date.now() + 3600 * 1000); // Default 1 hour
    }

    // Create Drive and Sheets clients
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

    // Search for existing "Bear Valley Run Checks" folder
    const folderSearchResponse = await drive.files.list({
      q: "name='Bear Valley Run Checks' and mimeType='application/vnd.google-apps.folder' and trashed=false",
      fields: 'files(id, name)',
      spaces: 'drive',
    });

    let folderId: string;
    if (folderSearchResponse.data.files && folderSearchResponse.data.files.length > 0) {
      // Reuse existing folder
      folderId = folderSearchResponse.data.files[0].id || '';
      logger.info('Found existing Drive folder', { folderId, folderName: folderSearchResponse.data.files[0].name });
    } else {
      // Create new folder
      const folderMetadata = {
        name: 'Bear Valley Run Checks',
        mimeType: 'application/vnd.google-apps.folder',
      };
      const folderResponse = await drive.files.create({
        requestBody: folderMetadata,
        fields: 'id, name',
      });
      folderId = folderResponse.data.id || '';
      logger.info('Created new Drive folder', { folderId, folderName: folderResponse.data.name });
    }

    // Search for existing "Run Names" spreadsheet in the folder
    const sheetSearchResponse = await drive.files.list({
      q: `name='Run Names' and '${folderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
      fields: 'files(id, name)',
      spaces: 'drive',
    });

    let runNamesSheetId: string;
    if (sheetSearchResponse.data.files && sheetSearchResponse.data.files.length > 0) {
      // Reuse existing spreadsheet
      runNamesSheetId = sheetSearchResponse.data.files[0].id || '';
      logger.info('Found existing Run Names spreadsheet', { spreadsheetId: runNamesSheetId });
    } else {
      // Create new spreadsheet
      const spreadsheetMetadata = {
        name: 'Run Names',
        mimeType: 'application/vnd.google-apps.spreadsheet',
        parents: [folderId],
      };
      const spreadsheetResponse = await drive.files.create({
        requestBody: spreadsheetMetadata,
        fields: 'id, name',
      });
      runNamesSheetId = spreadsheetResponse.data.id || '';
      logger.info('Created new Run Names spreadsheet', { spreadsheetId: runNamesSheetId });

      // Initialize the spreadsheet with headers (only for new spreadsheets)
      await sheets.spreadsheets.values.update({
        spreadsheetId: runNamesSheetId,
        range: 'Sheet1!A1:B1',
        valueInputOption: 'RAW',
        requestBody: {
          values: [['Section', 'Run Name']],
        },
      });
      logger.info('Initialized Run Names spreadsheet with headers');
    }

    // Store or update OAuth credentials in database
    await prisma.googleOAuth.upsert({
      where: { userId: req.user!.id },
      create: {
        userId: req.user!.id,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiresAt: expiresAt,
        googleEmail,
        googleDriveFolderId: folderId,
        googleSheetsId: runNamesSheetId,
        lastTestedAt: new Date(),
        isActive: true,
      },
      update: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiresAt: expiresAt,
        googleEmail,
        googleDriveFolderId: folderId,
        googleSheetsId: runNamesSheetId,
        lastTestedAt: new Date(),
        isActive: true,
      },
    });

    logger.info('OAuth tokens stored successfully', { userId: req.user!.id, googleEmail });

    // Schedule next automatic refresh
    await scheduleNextRefresh();

    // Redirect back to admin panel
    res.redirect('/?tab=admin&oauth=success');
  } catch (error: any) {
    logger.error('OAuth callback error:', error);
    res.redirect('/?tab=admin&oauth=error');
  }
});

// POST /api/google/oauth/folder - Update selected folder
router.post('/oauth/folder', requireAuth, requireAdmin, async (req, res) => {
  const { folderId, folderName, sheetsId } = req.body;

  if (!folderId) {
    return res.status(400).json({ error: 'Folder ID is required' });
  }

  try {
    const oauth = await prisma.googleOAuth.findUnique({
      where: { userId: req.user!.id },
    });

    if (!oauth) {
      return res.status(404).json({ error: 'OAuth not configured' });
    }

    await prisma.googleOAuth.update({
      where: { userId: req.user!.id },
      data: {
        googleDriveFolderId: folderId,
        googleSheetsId: sheetsId || null,
      },
    });

    logger.info('Google Drive folder updated', { userId: req.user!.id, folderId, folderName });

    res.json({ 
      success: true,
      folder: { id: folderId, name: folderName },
    });
  } catch (error: any) {
    logger.error('Error updating folder:', error);
    res.status(500).json({ error: 'Failed to update folder' });
  }
});

// POST /api/google/oauth/refresh - Manually refresh token
router.post('/oauth/refresh', requireAuth, requireAdmin, async (req, res) => {
  try {
    const oauth = await prisma.googleOAuth.findUnique({
      where: { userId: req.user!.id },
    });

    if (!oauth) {
      return res.status(404).json({ error: 'OAuth not configured' });
    }

    // Set up OAuth2 client with stored tokens
    oauth2Client.setCredentials({
      access_token: oauth.accessToken,
      refresh_token: oauth.refreshToken,
    });

    // Refresh the token
    const { credentials } = await oauth2Client.refreshAccessToken();
    
    if (!credentials.access_token) {
      throw new Error('Failed to refresh access token');
    }

    const expiresAt = new Date();
    if (credentials.expiry_date) {
      expiresAt.setTime(credentials.expiry_date);
    } else {
      expiresAt.setTime(Date.now() + 3600 * 1000);
    }

    // Update stored tokens
    await prisma.googleOAuth.update({
      where: { userId: req.user!.id },
      data: {
        accessToken: credentials.access_token,
        refreshToken: credentials.refresh_token || oauth.refreshToken,
        tokenExpiresAt: expiresAt,
        lastTestedAt: new Date(),
      },
    });

    logger.info('OAuth token refreshed manually', { userId: req.user!.id });

    // Reschedule the next automatic refresh based on new expiration
    await scheduleNextRefresh();

    res.json({
      success: true,
      expiresAt,
      lastTestedAt: new Date(),
    });
  } catch (error: any) {
    logger.error('Error refreshing token:', error);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});

// GET /api/google/oauth/status - Check OAuth status
router.get('/oauth/status', requireAuth, requireAdmin, async (req, res) => {
  try {
    const oauth = await prisma.googleOAuth.findFirst({
      where: { isActive: true },
      include: {
        user: {
          select: { email: true, name: true },
        },
      },
    });

    if (!oauth) {
      return res.json({ 
        configured: false,
        needsRefresh: false,
      });
    }

    res.json({
      configured: true,
      linkedUser: {
        email: oauth.user.email,
        name: oauth.user.name,
      },
      googleEmail: oauth.googleEmail,
      folderId: oauth.googleDriveFolderId,
      sheetsId: oauth.googleSheetsId,
      tokenExpiresAt: oauth.tokenExpiresAt,
      isActive: oauth.isActive,
    });
  } catch (error: any) {
    logger.error('Error checking OAuth status:', error);
    res.status(500).json({ error: 'Failed to check OAuth status' });
  }
});

// DELETE /api/google/oauth/disconnect - Remove OAuth connection
router.delete('/oauth/disconnect', requireAuth, requireAdmin, async (req, res) => {
  try {
    await prisma.googleOAuth.deleteMany({
      where: { userId: req.user!.id },
    });

    logger.info('OAuth disconnected', { userId: req.user!.id });

    res.json({ success: true });
  } catch (error: any) {
    logger.error('Error disconnecting OAuth:', error);
    res.status(500).json({ error: 'Failed to disconnect OAuth' });
  }
});

// POST /api/google/oauth/test-mark-inactive - Testing endpoint to force inactive state
router.post('/oauth/test-mark-inactive', requireAuth, requireAdmin, async (req, res) => {
  try {
    const oauth = await prisma.googleOAuth.findFirst({
      where: { isActive: true },
    });

    if (!oauth) {
      return res.status(404).json({ error: 'No active OAuth configuration found' });
    }

    await prisma.googleOAuth.update({
      where: { id: oauth.id },
      data: { isActive: false },
    });

    logger.info('OAuth manually marked as inactive for testing', { userId: req.user!.id });

    res.json({
      success: true,
      message: 'OAuth marked as inactive for testing. Next successful API call will reactivate it.'
    });
  } catch (error: any) {
    logger.error('Error marking OAuth inactive:', error);
    res.status(500).json({ error: 'Failed to mark OAuth inactive' });
  }
});

export default router;
