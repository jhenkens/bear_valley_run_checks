import { google } from 'googleapis';
import { formatInTimeZone } from 'date-fns-tz';
import { appConfig } from '../config/config';
import { logger } from '../utils/logger';
import { getAuthenticatedSheetsClient } from './googleOAuth';

export interface RunCheck {
  id: string;
  runName: string;
  section: string;
  patroller: string;
  checkTime: Date;
  createdAt: Date;
}

const CHECK_HEADERS = ['Timestamp', 'Check Time', 'Section', 'Run Name', 'Patroller'];

// The season spreadsheet holds one tab per day. Seasons run July 1 - June 30,
// e.g. "2026-2027 Run-Checks" covers 2026-07-01 through 2027-06-30.
let seasonSpreadsheetId: string = '';
let seasonSpreadsheetName: string = ''; // which season the cached id belongs to

// Tracks the most recent "<spreadsheetId>|<date>" we've confirmed has a tab,
// so we don't re-fetch spreadsheet metadata on every single append.
let cachedTabKey: string = '';

export async function initializeGoogleSheets(): Promise<void> {
  if (appConfig.runProvider !== 'sheets') {
    return;
  }

  // OAuth will be checked when actually making API calls
  logger.info('Google Sheets configured to use OAuth authentication');
}

/**
 * Get today's date in the configured timezone (YYYY-MM-DD format).
 * Used as the name of today's tab within the season spreadsheet, and by
 * runCheckCache to detect when the calendar day has rolled over.
 */
export function getTodaySheetName(): string {
  return formatInTimeZone(new Date(), appConfig.timezone, 'yyyy-MM-dd');
}

/**
 * Get the name of the current season's spreadsheet, e.g. "2026-2027 Run-Checks".
 * Seasons run July 1 - June 30: any date from July onward belongs to the
 * season starting that year; dates January-June belong to the season that
 * started the previous July.
 */
function getSeasonStartYear(): number {
  const yearMonth = formatInTimeZone(new Date(), appConfig.timezone, 'yyyy-MM');
  const [yearStr, monthStr] = yearMonth.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  return month >= 7 ? year : year - 1;
}

function getSeasonName(): string {
  const startYear = getSeasonStartYear();
  return `${startYear}-${startYear + 1} Run-Checks`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/**
 * Weekday-of-a-calendar-date is a plain calendar fact (Sept 17 2026 is a
 * Thursday everywhere), so this works purely in UTC internally to get a
 * deterministic answer no matter what timezone the server process happens to
 * run in (e.g. a Docker container defaulting to TZ=UTC). Returns a
 * "yyyy-MM-dd" string rather than a Date so nothing downstream can
 * accidentally print or reinterpret it through an ambient timezone again -
 * that's what made a correct calculation look wrong.
 */
function getNthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): string {
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const day = 1 + ((weekday - firstWeekday + 7) % 7) + (n - 1) * 7;
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}

/**
 * The last occurrence of a weekday in a month, as a UTC-midnight Date.
 */
function getLastWeekdayOfMonth(year: number, month: number, weekday: number): Date {
  const lastOfMonth = new Date(Date.UTC(year, month + 1, 0));
  const diff = (lastOfMonth.getUTCDay() - weekday + 7) % 7;
  return new Date(Date.UTC(year, month, lastOfMonth.getUTCDate() - diff));
}

/**
 * Shift a "yyyy-MM-dd" calendar-date string by a number of days (may be
 * negative), staying purely in calendar-date terms.
 */
function addDaysToDateString(dateString: string, days: number): string {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * The ski season's "auto-create a tab every day" window: from the Wednesday
 * before Thanksgiving through the second-to-last Sunday in April. Within
 * this window, patrol activity is expected every day, so callers may
 * proactively create each day's tab even if nobody has submitted a check
 * yet. Outside it, tabs stay lazy - only created on an actual submission.
 */
function isWithinDailyTabWindow(): boolean {
  const seasonStartYear = getSeasonStartYear();

  const thanksgiving = getNthWeekdayOfMonth(seasonStartYear, 10, 4, 4); // 4th Thursday of November
  const wedBeforeThanksgiving = addDaysToDateString(thanksgiving, -1);

  const lastSundayApril = getLastWeekdayOfMonth(seasonStartYear + 1, 3, 0); // last Sunday of April
  const secondToLastSundayApril = new Date(lastSundayApril);
  secondToLastSundayApril.setUTCDate(secondToLastSundayApril.getUTCDate() - 7);

  const today = getTodaySheetName();
  return today >= wedBeforeThanksgiving && today <= secondToLastSundayApril.toISOString().slice(0, 10);
}

/**
 * Format a date to a string in the configured timezone
 * Returns format: YYYY-MM-DD HH:mm:ss zzz (e.g., 2026-01-20 14:30:00 PST)
 */
function formatDateInTimezone(date: Date): string {
  return formatInTimeZone(date, appConfig.timezone, 'yyyy-MM-dd HH:mm:ss zzz');
}

/**
 * Look for the current season's spreadsheet without creating one.
 * Returns null if it doesn't exist yet (e.g. nobody has submitted a run
 * check this season), so callers that only want to read data don't force a
 * spreadsheet into existence.
 */
async function findSeasonSpreadsheet(): Promise<string | null> {
  const seasonName = getSeasonName();

  if (seasonSpreadsheetId && seasonSpreadsheetName === seasonName) {
    return seasonSpreadsheetId;
  }

  const { drive, folderId } = await getAuthenticatedSheetsClient();

  if (!folderId) {
    throw new Error('Google Drive folder not configured. Please select a folder in admin settings.');
  }

  const searchResponse = await drive.files.list({
    q: `name='${seasonName}' and '${folderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
    fields: 'files(id, name)',
    spaces: 'drive',
  });

  if (searchResponse.data.files && searchResponse.data.files.length > 0) {
    seasonSpreadsheetId = searchResponse.data.files[0].id || '';
    seasonSpreadsheetName = seasonName;
    logger.info(`Found existing season spreadsheet: ${seasonName} (${seasonSpreadsheetId})`);
    return seasonSpreadsheetId;
  }

  return null;
}

/**
 * Write the header row into a freshly-created tab.
 */
async function writeTabHeaders(spreadsheetId: string, tabName: string): Promise<void> {
  const { sheets } = await getAuthenticatedSheetsClient();

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!A1:E1`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [CHECK_HEADERS],
    },
  });
}

/**
 * Create the current season's spreadsheet, with today's tab as its only
 * sheet. Only called when a spreadsheet is actually about to be written to -
 * calling it unconditionally (e.g. on a schedule) would create an empty
 * spreadsheet/tab every day even on days nobody uses the app.
 */
async function createSeasonSpreadsheet(): Promise<string> {
  const seasonName = getSeasonName();
  const today = getTodaySheetName();

  const { sheets, drive, folderId } = await getAuthenticatedSheetsClient();

  if (!folderId) {
    throw new Error('Google Drive folder not configured. Please select a folder in admin settings.');
  }

  const createResponse = await drive.files.create({
    requestBody: {
      name: seasonName,
      mimeType: 'application/vnd.google-apps.spreadsheet',
      parents: [folderId],
    },
    fields: 'id',
  });

  const newSpreadsheetId = createResponse.data.id;

  if (!newSpreadsheetId) {
    throw new Error('Failed to create spreadsheet: no ID returned');
  }

  // Rename the spreadsheet's default sheet to today's date rather than
  // adding a second sheet - a fresh season spreadsheet only ever starts
  // with today (nobody submits a check for a past day).
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: newSpreadsheetId,
    requestBody: {
      requests: [
        {
          updateSheetProperties: {
            properties: {
              sheetId: 0,
              title: today,
            },
            fields: 'title',
          },
        },
      ],
    },
  });

  await writeTabHeaders(newSpreadsheetId, today);

  seasonSpreadsheetId = newSpreadsheetId;
  seasonSpreadsheetName = seasonName;
  cachedTabKey = `${newSpreadsheetId}|${today}`;
  logger.info(`Created new season spreadsheet: ${seasonName} (${newSpreadsheetId}) with tab ${today}`);

  return newSpreadsheetId;
}

/**
 * Find the current season's spreadsheet, creating it (with today's tab) if
 * it doesn't exist yet.
 */
async function ensureSeasonSpreadsheet(): Promise<string> {
  const existingId = await findSeasonSpreadsheet();
  if (existingId) {
    return existingId;
  }

  return createSeasonSpreadsheet();
}

/**
 * Check whether today's tab already exists in the given spreadsheet, without
 * creating it.
 */
async function findDailyTab(spreadsheetId: string): Promise<boolean> {
  const today = getTodaySheetName();
  const key = `${spreadsheetId}|${today}`;

  if (cachedTabKey === key) {
    return true;
  }

  const { sheets } = await getAuthenticatedSheetsClient();
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = (spreadsheet.data.sheets || []).some(
    (sheet) => sheet.properties?.title === today
  );

  if (exists) {
    cachedTabKey = key;
  }

  return exists;
}

/**
 * Ensure today's tab exists in the given season spreadsheet, creating it at
 * the leftmost position (index 0) if needed so the most recent date always
 * sorts first. Only call this on the write path (a check is actually being
 * submitted) - never on a schedule or read path.
 */
async function ensureDailyTab(spreadsheetId: string): Promise<string> {
  const today = getTodaySheetName();

  if (await findDailyTab(spreadsheetId)) {
    return today;
  }

  const { sheets } = await getAuthenticatedSheetsClient();

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title: today,
              index: 0,
            },
          },
        },
      ],
    },
  });

  await writeTabHeaders(spreadsheetId, today);

  cachedTabKey = `${spreadsheetId}|${today}`;
  logger.info(`Created new daily tab: ${today} in season spreadsheet ${spreadsheetId}`);

  return today;
}

/**
 * Ensure both the season spreadsheet and today's tab exist, creating
 * whichever is missing. Only call this when a check is actually about to be
 * written.
 */
async function ensureTodayTab(): Promise<{ spreadsheetId: string; tabName: string }> {
  const spreadsheetId = await ensureSeasonSpreadsheet();
  const tabName = await ensureDailyTab(spreadsheetId);
  return { spreadsheetId, tabName };
}

/**
 * If today falls within the ski season's daily-tab window (Wednesday before
 * Thanksgiving through the second-to-last Sunday in April), proactively
 * create today's tab - and the season spreadsheet, if needed - even though
 * nobody has submitted a check yet. Outside that window this is a no-op;
 * tabs remain lazy, created only when appendRunCheck actually writes one.
 */
export async function ensureTodayTabForActiveSeason(): Promise<void> {
  if (appConfig.runProvider !== 'sheets') {
    return;
  }

  if (!isWithinDailyTabWindow()) {
    return;
  }

  try {
    await ensureTodayTab();
  } catch (error) {
    logger.error('Error ensuring daily tab for active season:', error);
  }
}

export async function loadTodayChecks(): Promise<RunCheck[]> {
  if (appConfig.runProvider !== 'sheets') {
    return [];
  }

  try {
    const spreadsheetId = await findSeasonSpreadsheet();
    if (!spreadsheetId) {
      // Nobody has submitted a check this season yet - nothing to load.
      return [];
    }

    if (!(await findDailyTab(spreadsheetId))) {
      // Nobody has submitted a check today yet - don't create a tab just to
      // read an empty one.
      return [];
    }

    const today = getTodaySheetName();
    const authClient = await getAuthenticatedSheetsClient();

    const response = await authClient.sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${today}!A2:E`,
    });

    const rows = response.data.values || [];
    return rows.map((row: string[], index: number) => ({
      id: `${today}-${index}`,
      runName: row[3] || '',
      section: row[2] || '',
      patroller: row[4] || '',
      checkTime: new Date(row[1] || row[0]),
      createdAt: new Date(row[0]),
    }));
  } catch (error) {
    logger.error('Error loading checks from spreadsheet:', error);
    return [];
  }
}

export async function appendRunCheck(check: Omit<RunCheck, 'id' | 'createdAt'>): Promise<boolean> {
  if (appConfig.runProvider !== 'sheets') {
    // Not using sheets provider, return true (no-op success)
    return true;
  }

  try {
    const { sheets } = await getAuthenticatedSheetsClient();
    const { spreadsheetId, tabName } = await ensureTodayTab();

    // Format timestamps in configured timezone instead of UTC
    const nowFormatted = formatDateInTimezone(new Date());
    const checkTimeFormatted = formatDateInTimezone(check.checkTime);

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${tabName}!A:E`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[
          nowFormatted,
          checkTimeFormatted,
          check.section,
          check.runName,
          check.patroller,
        ]],
      },
    });

    logger.info('Successfully saved run check to Google Sheets', {
      runName: check.runName,
      section: check.section,
      patroller: check.patroller
    });

    return true;
  } catch (error) {
    logger.error('Failed to save run check to Google Sheets:', error);
    // Don't throw - return false to indicate failure
    // This allows the in-memory cache to still work
    return false;
  }
}
