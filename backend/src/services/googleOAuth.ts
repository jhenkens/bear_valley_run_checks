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
 * Refreshes proactively when token has 5 minutes or less remaining
 */
export async function refreshTokenIfNeeded(oauthRecord: any): Promise<OAuthTokens> {
  const now = new Date();
  const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

  // Check if token is expired or will expire in next 5 minutes
  // We refresh proactively to ensure the token never actually expires
  if (oauthRecord.tokenExpiresAt > fiveMinutesFromNow) {
    // Token is still valid for at least 5 more minutes
    return {
      accessToken: oauthRecord.accessToken,
      refreshToken: oauthRecord.refreshToken,
      expiresAt: oauthRecord.tokenExpiresAt,
    };
  }

  // Token expired or expiring soon, refresh it
  logger.info('Refreshing OAuth token (expires soon or expired)', { userId: oauthRecord.userId, expiresAt: oauthRecord.tokenExpiresAt });

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
  try {
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

    // Mark as active since we successfully authenticated
    await prisma.googleOAuth.update({
      where: { id: oauth.id },
      data: { isActive: true },
    });

    return {
      sheets,
      drive,
      folderId: oauth.googleDriveFolderId,
      sheetsId: oauth.googleSheetsId,
    };
  } catch (error) {
    logger.error('Failed to get authenticated sheets client:', error);

    // Mark as inactive on failure
    try {
      const oauth = await getActiveOAuth();
      if (oauth) {
        await prisma.googleOAuth.update({
          where: { id: oauth.id },
          data: { isActive: false },
        });
      }
    } catch (updateError) {
      logger.error('Failed to mark OAuth as inactive:', updateError);
    }

    throw error;
  }
}

/**
 * Run background validation and refresh of OAuth token
 * This keeps the token alive indefinitely through proactive refreshing
 */
export async function validateOAuthToken() {
  try {
    const oauth = await getActiveOAuth();

    if (!oauth) {
      logger.debug('No active OAuth configuration to validate');
      return;
    }

    logger.debug('Running background OAuth token refresh/validation', {
      userId: oauth.userId,
      tokenExpiresAt: oauth.tokenExpiresAt
    });

    // Refresh token if needed (within 5 minutes of expiry)
    const tokens = await refreshTokenIfNeeded(oauth);

    // Test token with API call to verify it's actually working
    const isValid = await testOAuthToken(tokens.accessToken);

    if (isValid) {
      // Mark as active (in case it was previously marked inactive)
      await prisma.googleOAuth.update({
        where: { id: oauth.id },
        data: { isActive: true },
      });
      logger.info('OAuth token validation successful', {
        userId: oauth.userId,
        tokenExpiresAt: tokens.expiresAt
      });
    } else {
      logger.error('OAuth token validation failed - marking as inactive', { userId: oauth.userId });
      // Mark as inactive so frontend shows warning
      await prisma.googleOAuth.update({
        where: { id: oauth.id },
        data: { isActive: false },
      });
    }
  } catch (error: any) {
    logger.error('Error during OAuth validation:', error);

    // Mark as inactive on error so frontend shows warning
    try {
      const oauth = await getActiveOAuth();
      if (oauth) {
        await prisma.googleOAuth.update({
          where: { id: oauth.id },
          data: { isActive: false },
        });
      }
    } catch (updateError) {
      logger.error('Failed to mark OAuth as inactive:', updateError);
    }
  }
}

// Store timeout handle so we can clear/reschedule
let refreshTimeout: NodeJS.Timeout | null = null;

/**
 * Schedule next OAuth token refresh
 * Schedules refresh for 10 minutes before token expiration
 */
export async function scheduleNextRefresh() {
  try {
    const oauth = await getActiveOAuth();

    if (!oauth) {
      logger.debug('No active OAuth configuration to schedule refresh for');
      return;
    }

    const now = new Date();
    const tenMinutesBeforeExpiry = new Date(oauth.tokenExpiresAt.getTime() - 10 * 60 * 1000);
    const msUntilRefresh = tenMinutesBeforeExpiry.getTime() - now.getTime();

    // If token expires in less than 10 minutes, refresh immediately
    if (msUntilRefresh <= 0) {
      logger.info('Token expires soon, refreshing immediately', {
        expiresAt: oauth.tokenExpiresAt,
        now: now
      });
      await validateOAuthToken();
      // After refreshing, schedule the next one
      await scheduleNextRefresh();
      return;
    }

    // Clear any existing timeout
    if (refreshTimeout) {
      clearTimeout(refreshTimeout);
    }

    // Schedule refresh for 10 minutes before expiration
    logger.info('Scheduled OAuth token refresh', {
      expiresAt: oauth.tokenExpiresAt,
      refreshAt: tenMinutesBeforeExpiry,
      msUntilRefresh: msUntilRefresh
    });

    refreshTimeout = setTimeout(async () => {
      logger.info('Running scheduled OAuth token refresh');
      await validateOAuthToken();
      // After refreshing, schedule the next one based on new expiration
      await scheduleNextRefresh();
    }, msUntilRefresh);

  } catch (error) {
    logger.error('Error scheduling OAuth refresh:', error);
    // Retry in 5 minutes if scheduling fails
    refreshTimeout = setTimeout(async () => {
      await scheduleNextRefresh();
    }, 5 * 60 * 1000);
  }
}

/**
 * Start OAuth token refresh scheduler
 * Schedules refresh for 10 minutes before token expiration
 */
export function startOAuthValidationScheduler() {
  logger.info('Starting OAuth validation scheduler');

  // Run initial validation and schedule first refresh after brief delay
  setTimeout(async () => {
    await validateOAuthToken();
    await scheduleNextRefresh();
  }, 10000); // Wait 10 seconds after startup
}
