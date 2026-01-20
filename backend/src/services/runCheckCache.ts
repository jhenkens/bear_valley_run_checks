import { RunCheck, loadTodayChecks, appendRunCheck as appendToSheet } from './googleSheets';
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

  // Get current time components in the configured timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: appConfig.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  const parts = formatter.formatToParts(now);
  const year = parts.find(p => p.type === 'year')!.value;
  const month = parts.find(p => p.type === 'month')!.value;
  const day = parts.find(p => p.type === 'day')!.value;
  const hour = parseInt(parts.find(p => p.type === 'hour')!.value);
  const minute = parseInt(parts.find(p => p.type === 'minute')!.value);
  const second = parseInt(parts.find(p => p.type === 'second')!.value);

  // Calculate seconds until midnight in the timezone
  const secondsSinceMidnight = hour * 3600 + minute * 60 + second;
  const secondsInDay = 24 * 3600;
  const secondsUntilMidnight = secondsInDay - secondsSinceMidnight;

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
