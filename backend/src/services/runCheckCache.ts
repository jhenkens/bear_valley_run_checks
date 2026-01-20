import { RunCheck, loadTodayChecks, appendRunCheck as appendToSheet } from './googleSheets';
import { config } from '../config/config';

let cache: RunCheck[] = [];
let lastRefresh: Date = new Date();

export async function initialize(): Promise<void> {
  if (config.runProvider === 'sheets') {
    cache = await loadTodayChecks();
    lastRefresh = new Date();
    console.log(`Run check cache initialized with ${cache.length} checks`);
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

  // Persist to Google Sheets if configured
  if (config.runProvider === 'sheets') {
    try {
      await appendToSheet(check);
    } catch (error) {
      console.error('Failed to append check to sheet:', error);
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
    console.log('Midnight reload triggered');
    clearCache();
    if (config.runProvider === 'sheets') {
      cache = await loadTodayChecks();
    }
    scheduleMidnightReload(); // Schedule next reload
  }, msUntilMidnight);

  console.log(`Scheduled midnight reload in ${Math.round(msUntilMidnight / 1000 / 60)} minutes`);
}

export function getLastRefreshTime(): Date {
  return lastRefresh;
}
