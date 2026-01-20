import { RunCheck, loadTodayChecks, appendRunCheck as appendToSheet } from './googleSheets';
import { formatInTimeZone } from 'date-fns-tz';
import { appConfig } from '../config/config';
import { logger } from '../utils/logger';

let cache: RunCheck[] = [];
let lastRefresh: Date = new Date();

export async function initialize(): Promise<void> {
  if (appConfig.runProvider === 'sheets') {
    cache = await loadTodayChecks();
    lastRefresh = new Date();
    logger.info(`Run check cache initialized with ${cache.length} checks from Google Sheets`);
  } else {
    logger.info(`Run check cache initialized (in-memory only)`);
  }

  // Schedule midnight reload (in configured timezone)
  scheduleMidnightReload();
}

export function getChecks(): RunCheck[] {
  return [...cache];
}

export async function addCheck(check: Omit<RunCheck, 'id' | 'createdAt'>): Promise<{ check: RunCheck; googleDriveSaved: boolean }> {
  const newCheck: RunCheck = {
    ...check,
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    createdAt: new Date(),
  };

  cache.push(newCheck);

  // Persist to Google Sheets if configured
  let googleDriveSaved = false;
  if (appConfig.runProvider === 'sheets') {
    googleDriveSaved = await appendToSheet(check);
  }

  return { check: newCheck, googleDriveSaved };
}

export function clearCache(): void {
  cache = [];
  lastRefresh = new Date();
}

/**
 * Calculate milliseconds until midnight in the configured timezone
 */
function getMsUntilMidnight(): number {
  const now = new Date();

  // Get current time in HH:mm:ss format in the configured timezone
  const timeString = formatInTimeZone(now, appConfig.timezone, 'HH:mm:ss');
  const [hours, minutes, seconds] = timeString.split(':').map(Number);

  // Calculate seconds since midnight
  const secondsSinceMidnight = hours * 3600 + minutes * 60 + seconds;

  // Calculate seconds until midnight (24 hours = 86400 seconds)
  const secondsUntilMidnight = 86400 - secondsSinceMidnight;

  return secondsUntilMidnight * 1000;
}

function scheduleMidnightReload(): void {
  const msUntilMidnight = getMsUntilMidnight();

  setTimeout(async () => {
    logger.info('Midnight reload triggered (in configured timezone)');
    clearCache();
    if (appConfig.runProvider === 'sheets') {
      cache = await loadTodayChecks();
    }
    scheduleMidnightReload(); // Schedule next reload
  }, msUntilMidnight);

  logger.info(`Scheduled midnight reload in ${Math.round(msUntilMidnight / 1000 / 60)} minutes (timezone: ${appConfig.timezone})`);
}

export function getLastRefreshTime(): Date {
  return lastRefresh;
}
