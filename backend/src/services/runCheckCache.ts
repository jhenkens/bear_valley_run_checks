import cron from 'node-cron';
import { RunCheck, loadTodayChecks, appendRunCheck as appendToSheet, ensureTodayTabForActiveSeason, getTodaySheetName } from './googleSheets';
import { formatInTimeZone } from 'date-fns-tz';
import { appConfig } from '../config/config';
import { logger } from '../utils/logger';

interface CachedRunCheck extends RunCheck {
  writtenToSheet: boolean;
}

// Don't auto-create the day's tab in the middle of the night - wait until
// this hour (in the configured timezone) has passed.
const EARLIEST_AUTO_TAB_HOUR = 3;

let cache: CachedRunCheck[] = [];
let lastRefresh: Date = new Date();
let cachedDay: string = ''; // calendar day (configured timezone) the cache currently represents

export async function initialize(): Promise<void> {
  if (appConfig.runProvider === 'sheets') {
    await checkAndReload();
    logger.info(`Run check cache initialized with ${cache.length} checks from Google Sheets`);
  } else {
    logger.info(`Run check cache initialized (in-memory only)`);
  }

  scheduleHourlyCheck();
}

export async function getChecks(): Promise<RunCheck[]> {
  await ensureCacheForToday();
  return [...cache];
}

export async function addCheck(check: Omit<RunCheck, 'id' | 'createdAt'>): Promise<{ check: RunCheck; googleDriveSaved: boolean }> {
  await ensureCacheForToday();

  const newCheck: CachedRunCheck = {
    ...check,
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    createdAt: new Date(),
    writtenToSheet: false,
  };

  cache.push(newCheck);

  // Persist ALL unwritten checks to Google Sheets if configured
  let googleDriveSaved = false;
  if (appConfig.runProvider === 'sheets') {
    googleDriveSaved = await flushPendingChecks();
  }

  return { check: newCheck, googleDriveSaved };
}

/**
 * Write all checks that haven't been written to Google Sheets yet
 * Returns true if all writes succeeded
 */
async function flushPendingChecks(): Promise<boolean> {
  const pendingChecks = cache.filter(c => !c.writtenToSheet);
  
  if (pendingChecks.length === 0) {
    return true;
  }

  logger.info(`Flushing ${pendingChecks.length} pending checks to Google Sheets`);
  
  let allSucceeded = true;
  for (const check of pendingChecks) {
    const success = await appendToSheet(check);
    if (success) {
      check.writtenToSheet = true;
    } else {
      allSucceeded = false;
    }
  }

  if (allSucceeded) {
    logger.info(`Successfully flushed all ${pendingChecks.length} pending checks`);
  } else {
    const stillPending = cache.filter(c => !c.writtenToSheet).length;
    logger.warn(`Some checks failed to write. ${stillPending} checks still pending`);
  }

  return allSucceeded;
}

export function clearCache(): void {
  cache = [];
  lastRefresh = new Date();
}

/**
 * If the calendar day (in the configured timezone) has rolled over since the
 * cache was last loaded, reset it and reload today's checks from the sheet.
 * No-op otherwise, so this is cheap to call on every cache read/write as
 * well as from the hourly schedule.
 *
 * Any checks still waiting to be written to the sheet are flushed first. If
 * that flush doesn't fully succeed, the reset is deferred rather than
 * clearing them out from under an in-flight write - we'll retry on the next
 * call instead of silently losing data at the day boundary.
 */
async function ensureCacheForToday(): Promise<void> {
  const today = getTodaySheetName();
  if (today === cachedDay) {
    return;
  }

  if (appConfig.runProvider === 'sheets') {
    const flushed = await flushPendingChecks();
    if (!flushed) {
      const stillPending = cache.filter(c => !c.writtenToSheet).length;
      logger.warn(
        `Day rollover to ${today} deferred - ${stillPending} check(s) still unflushed from ${cachedDay || 'the previous day'}`
      );
      return;
    }
  }

  logger.info(`Day rollover detected (${cachedDay || 'none'} -> ${today}), reloading run check cache`);
  clearCache();

  if (appConfig.runProvider === 'sheets') {
    const loadedChecks = await loadTodayChecks();
    cache = loadedChecks.map(check => ({ ...check, writtenToSheet: true }));
  }

  cachedDay = today;
}

async function checkAndReload(): Promise<void> {
  if (appConfig.runProvider !== 'sheets') {
    return;
  }

  await ensureCacheForToday();

  const hour = parseInt(formatInTimeZone(new Date(), appConfig.timezone, 'HH'), 10);
  if (hour >= EARLIEST_AUTO_TAB_HOUR) {
    // Cheap/idempotent once today's tab exists - only touches the Sheets API
    // when there's actually something missing to create.
    await ensureTodayTabForActiveSeason();
  }
}

function scheduleHourlyCheck(): void {
  cron.schedule('5 * * * *', async () => {
    try {
      await checkAndReload();
    } catch (error) {
      logger.error('Error during hourly run check cache check:', error);
    }
  }, {
    name: 'run-check-hourly-check',
    timezone: appConfig.timezone,
    noOverlap: true,
  });

  logger.info(`Scheduled hourly run check cache check (5 minutes past every hour, timezone: ${appConfig.timezone})`);
}

export function getLastRefreshTime(): Date {
  return lastRefresh;
}
