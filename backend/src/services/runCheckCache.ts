import { RunCheck, loadTodayChecks, appendRunCheck as appendToSheet } from './googleSheets';
import { appConfig } from '../config/config';
import { logger } from '../utils/logger';

let cache: RunCheck[] = [];
let lastRefresh: Date = new Date();

export async function initialize(): Promise<void> {
  if (appConfig.runProvider === 'sheets' && process.env.NODE_ENV === 'production') {
    cache = await loadTodayChecks();
    lastRefresh = new Date();
    logger.info(`Run check cache initialized with ${cache.length} checks from Google Sheets`);
  } else {
    logger.info(`Run check cache initialized (in-memory only)`);
  }

  // Schedule midnight reload
  scheduleMidnightReload();
}

export function getChecks(): RunCheck[] {
  return [...cache];
}

export async function addCheck(check: Omit<RunCheck, 'id' | 'createdAt'>): Promise<RunCheck> {
  const newCheck: RunCheck = {
    ...check,
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    createdAt: new Date(),
  };

  cache.push(newCheck);

  // Persist to Google Sheets if configured and in production
  if (appConfig.runProvider === 'sheets' && process.env.NODE_ENV === 'production') {
    try {
      await appendToSheet(check);
    } catch (error) {
      logger.error('Failed to append check to sheet:', error);
      // Keep in cache anyway
    }
  }

  return newCheck;
}

export function clearCache(): void {
  cache = [];
  lastRefresh = new Date();
}

function scheduleMidnightReload(): void {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  const msUntilMidnight = tomorrow.getTime() - now.getTime();

  setTimeout(async () => {
    logger.info('Midnight reload triggered');
    clearCache();
    if (appConfig.runProvider === 'sheets' && process.env.NODE_ENV === 'production') {
      cache = await loadTodayChecks();
    }
    scheduleMidnightReload(); // Schedule next reload
  }, msUntilMidnight);

  logger.debug(`Scheduled midnight reload in ${Math.round(msUntilMidnight / 1000 / 60)} minutes`);
}

export function getLastRefreshTime(): Date {
  return lastRefresh;
}
