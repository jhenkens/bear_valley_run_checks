import { google } from 'googleapis';
import { prisma } from '../config/database';
import { appConfig } from '../config/config';
import { logger } from '../utils/logger';

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

// Get OAuth2 client configured with environment credentials
function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${appConfig.appUrl}/api/google/oauth/callback`
  );
}

/**
 * Get active OAuth configuration from database
 */
export async function getActiveOAuth() {
  return await prisma.googleOAuth.findFirst({
    where: { isActive: true },
    include: {
      user: {
        select: { id: true, email: true, name: true },
      },
    },
  });
}

/**
 * Refresh OAuth access token if expired or about to expire
 */
export async function refreshTokenIfNeeded(oauthRecord: any): Promise<OAuthTokens> {
  const now = new Date();
  const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

  // Check if token is expired or will expire in next 5 minutes
  if (oauthRecord.tokenExpiresAt > fiveMinutesFromNow) {
    // Token is still valid
    return {
      accessToken: oauthRecord.accessToken,
      refreshToken: oauthRecord.refreshToken,
      expiresAt: oauthRecord.tokenExpiresAt,
    };
  }

  // Token expired or expiring soon, refresh it
  logger.info('Refreshing OAuth token', { userId: oauthRecord.userId });

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({
    access_token: oauthRecord.accessToken,
    refresh_token: oauthRecord.refreshToken,
  });

  try {
    const { credentials } = await oauth2Client.refreshAccessToken();

    if (!credentials.access_token) {
      throw new Error('Failed to get new access token');
    }

    const expiresAt = new Date();
    if (credentials.expiry_date) {
      expiresAt.setTime(credentials.expiry_date);
    } else {
      expiresAt.setTime(Date.now() + 3600 * 1000);
    }

    // Update database with new tokens
    await prisma.googleOAuth.update({
      where: { id: oauthRecord.id },
      data: {
        accessToken: credentials.access_token,
        refreshToken: credentials.refresh_token || oauthRecord.refreshToken,
        tokenExpiresAt: expiresAt,
        lastTestedAt: new Date(),
      },
    });

    logger.info('OAuth token refreshed successfully', { userId: oauthRecord.userId });

    return {
      accessToken: credentials.access_token,
      refreshToken: credentials.refresh_token || oauthRecord.refreshToken,
      expiresAt,
    };
  } catch (error: any) {
    logger.error('Failed to refresh OAuth token:', error);
    throw new Error('OAuth token refresh failed. User needs to re-authenticate.');
  }
}

/**
 * Test OAuth token by making a simple API call
 */
export async function testOAuthToken(accessToken: string): Promise<boolean> {
  try {
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({ access_token: accessToken });

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    await oauth2.userinfo.get();

    return true;
  } catch (error: any) {
    logger.error('OAuth token test failed:', error);
    return false;
  }
}

/**
 * Get configured and authenticated Google Sheets API client
 */
export async function getAuthenticatedSheetsClient() {
  const oauth = await getActiveOAuth();

  if (!oauth) {
    throw new Error('Google OAuth not configured. Please link Google Drive in admin settings.');
  }

  // Refresh token if needed
  const tokens = await refreshTokenIfNeeded(oauth);

  // Create authenticated client
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  });

  const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  return {
    sheets,
    drive,
    folderId: oauth.googleDriveFolderId,
    sheetsId: oauth.googleSheetsId,
  };
}

/**
 * Run hourly validation check on OAuth token
 * This should be called by a cron job or scheduler
 */
export async function validateOAuthToken() {
  try {
    const oauth = await getActiveOAuth();

    if (!oauth) {
      logger.debug('No active OAuth configuration to validate');
      return;
    }

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    // Only test if hasn't been tested in the past hour
    if (oauth.lastTestedAt > oneHourAgo) {
      logger.debug('OAuth token was tested recently, skipping validation');
      return;
    }

    logger.info('Validating OAuth token', { userId: oauth.userId });

    // Refresh if needed
    const tokens = await refreshTokenIfNeeded(oauth);

    // Test token with API call
    const isValid = await testOAuthToken(tokens.accessToken);

    if (isValid) {
      // Update lastTestedAt
      await prisma.googleOAuth.update({
        where: { id: oauth.id },
        data: { lastTestedAt: new Date() },
      });
      logger.info('OAuth token validation successful', { userId: oauth.userId });
    } else {
      logger.error('OAuth token validation failed', { userId: oauth.userId });
      // Mark as inactive so users know to re-authenticate
      await prisma.googleOAuth.update({
        where: { id: oauth.id },
        data: { isActive: false },
      });
    }
  } catch (error: any) {
    logger.error('Error during OAuth validation:', error);
  }
}

/**
 * Start hourly validation scheduler
 */
export function startOAuthValidationScheduler() {
  // Run validation every hour
  const HOUR_IN_MS = 60 * 60 * 1000;
  
  setInterval(async () => {
    await validateOAuthToken();
  }, HOUR_IN_MS);

  // Also run once on startup
  setTimeout(async () => {
    await validateOAuthToken();
  }, 10000); // Wait 10 seconds after startup

  logger.info('OAuth validation scheduler started (runs hourly)');
}
