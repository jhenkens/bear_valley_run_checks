import { google } from 'googleapis';
import { prisma } from '../config/database';
import { appConfig } from '../config/config';
import { logger } from '../utils/logger';

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

// How far ahead of expiry to refresh. Used by both refreshTokenIfNeeded()
// (decides whether to actually call Google) and scheduleNextRefresh()
// (decides when to wake up and try) - they must agree, or
// scheduleNextRefresh() can decide "must refresh now" while
// refreshTokenIfNeeded() decides "still fine, do nothing," which spins
// forever since nothing ever advances the expiry.
const TOKEN_REFRESH_LEAD_MS = 10 * 60 * 1000;

// Floor on how soon scheduleNextRefresh() will re-check, even when a
// refresh is needed "now". Without this, a refresh that fails without
// advancing tokenExpiresAt (e.g. a revoked grant) would recurse with zero
// delay and busy-loop identically to the lead-time mismatch above.
const MIN_REFRESH_RETRY_MS = 60 * 1000;

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
 * Only returns OAuth records that are currently active
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
 * Get the latest OAuth configuration from database (active or inactive)
 * Used for status checking, display, and attempting reactivation
 */
export async function getLatestOAuth() {
  return await prisma.googleOAuth.findFirst({
    include: {
      user: {
        select: { id: true, email: true, name: true },
      },
    },
  });
}

/**
 * Refresh OAuth access token if expired or about to expire
 * Refreshes proactively when token has TOKEN_REFRESH_LEAD_MS or less remaining
 */
export async function refreshTokenIfNeeded(oauthRecord: any): Promise<OAuthTokens> {
  const now = new Date();
  const refreshThreshold = new Date(now.getTime() + TOKEN_REFRESH_LEAD_MS);

  // Check if token is expired or will expire within the lead time
  // We refresh proactively to ensure the token never actually expires
  if (oauthRecord.tokenExpiresAt > refreshThreshold) {
    // Token is still valid for longer than the lead time
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
 * Attempts to use OAuth even if marked inactive - will reactivate if successful
 */
export async function getAuthenticatedSheetsClient() {
  try {
    // Get ANY OAuth record (active or inactive) - we'll try to use it
    const oauth = await getLatestOAuth();

    if (!oauth) {
      throw new Error('Google OAuth not configured. Please link Google Drive in admin settings.');
    }

    // Refresh token if needed (this will throw if refresh fails)
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
    // This will reactivate an inactive OAuth if it works
    await prisma.googleOAuth.update({
      where: { id: oauth.id },
      data: { isActive: true },
    });

    logger.info('Google Sheets client authenticated successfully', {
      wasInactive: !oauth.isActive,
      userId: oauth.userId
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
      const oauth = await getLatestOAuth();
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
 * Will attempt to reactivate inactive OAuth if it works
 */
export async function validateOAuthToken() {
  try {
    // Get any OAuth (active or inactive) - we'll try to validate/reactivate it
    const oauth = await getLatestOAuth();

    if (!oauth) {
      logger.debug('No OAuth configuration to validate');
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
      const oauth = await getLatestOAuth();
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
 * Schedules refresh for TOKEN_REFRESH_LEAD_MS before token expiration.
 * Always goes through a real timer (never recurses synchronously), with a
 * minimum delay floor - so even if a refresh fails without advancing
 * tokenExpiresAt (e.g. a revoked grant), this backs off instead of spinning.
 * Works with both active and inactive OAuth to attempt reactivation
 */
export async function scheduleNextRefresh() {
  try {
    // Get any OAuth (active or inactive) - we'll schedule refresh to attempt reactivation
    const oauth = await getLatestOAuth();

    if (!oauth) {
      logger.debug('No OAuth configuration to schedule refresh for');
      return;
    }

    const now = new Date();
    const refreshAt = new Date(oauth.tokenExpiresAt.getTime() - TOKEN_REFRESH_LEAD_MS);
    const msUntilRefresh = Math.max(refreshAt.getTime() - now.getTime(), MIN_REFRESH_RETRY_MS);

    // Clear any existing timeout
    if (refreshTimeout) {
      clearTimeout(refreshTimeout);
    }

    logger.info('Scheduled OAuth token refresh', {
      expiresAt: oauth.tokenExpiresAt,
      refreshAt,
      msUntilRefresh,
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
