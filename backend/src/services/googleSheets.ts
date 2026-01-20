import { google } from 'googleapis';
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

let dailySpreadsheetId: string = ''; // Today's spreadsheet for checks
let dailySpreadsheetDate: string = ''; // Track which day's spreadsheet we have

export async function initializeGoogleSheets(): Promise<void> {
  // Skip in development mode
  if (process.env.NODE_ENV !== 'production') {
    logger.debug('Skipping Google Sheets initialization in development mode');
    return;
  }

  if (appConfig.runProvider !== 'sheets') {
    return;
  }

  // OAuth will be checked when actually making API calls
  logger.info('Google Sheets configured to use OAuth authentication');
}

function getTodaySheetName(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

export async function ensureDailySpreadsheet(): Promise<string> {
  const today = getTodaySheetName();
  
  // Check if we already have today's spreadsheet ID cached
  if (dailySpreadsheetId && dailySpreadsheetDate === today) {
    return dailySpreadsheetId;
  }

  try {
    // Get authenticated clients
    const { sheets, drive, folderId } = await getAuthenticatedSheetsClient();

    if (!folderId) {
      throw new Error('Google Drive folder not configured. Please select a folder in admin settings.');
    }

    // Search for existing spreadsheet in the folder
    const searchResponse = await drive.files.list({
      q: `name='${today}' and '${folderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
      fields: 'files(id, name)',
      spaces: 'drive',
    });

    if (searchResponse.data.files && searchResponse.data.files.length > 0) {
      // Found existing spreadsheet
      dailySpreadsheetId = searchResponse.data.files[0].id || '';
      dailySpreadsheetDate = today;
      logger.info(`Found existing daily spreadsheet: ${today} (${dailySpreadsheetId})`);
      return dailySpreadsheetId;
    }

    // Create new spreadsheet directly in the folder using Drive API
    const createResponse = await drive.files.create({
      requestBody: {
        name: today,
        mimeType: 'application/vnd.google-apps.spreadsheet',
        parents: [folderId],
      },
      fields: 'id',
    });

    const newSpreadsheetId = createResponse.data.id;

    if (!newSpreadsheetId) {
      throw new Error('Failed to create spreadsheet: no ID returned');
    }

    // Add "Run Checks" sheet and format it
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: newSpreadsheetId,
      requestBody: {
        requests: [
          {
            updateSheetProperties: {
              properties: {
                sheetId: 0,
                title: 'Run Checks',
              },
              fields: 'title',
            },
          },
        ],
      },
    });

    // Add headers
    await sheets.spreadsheets.values.update({
      spreadsheetId: newSpreadsheetId,
      range: 'Run Checks!A1:E1',
      valueInputOption: 'RAW',
      requestBody: {
        values: [['Timestamp', 'Check Time', 'Section', 'Run Name', 'Patroller']],
      },
    });

    dailySpreadsheetId = newSpreadsheetId;
    dailySpreadsheetDate = today;
    logger.info(`Created new daily spreadsheet: ${today} (${dailySpreadsheetId})`);
    
    return dailySpreadsheetId;
  } catch (error) {
    logger.error('Error ensuring daily spreadsheet:', error);
    throw error;
  }
}

export async function loadTodayChecks(): Promise<RunCheck[]> {
  if (appConfig.runProvider !== 'sheets' || process.env.NODE_ENV !== 'production') {
    return [];
  }

  try {
    const spreadsheetId = await ensureDailySpreadsheet();
    const authClient = await getAuthenticatedSheetsClient();
    
    const response = await authClient.sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Run Checks!A2:E',
    });

    const rows = response.data.values || [];
    const today = getTodaySheetName();
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

export async function appendRunCheck(check: Omit<RunCheck, 'id' | 'createdAt'>): Promise<void> {
  if (appConfig.runProvider !== 'sheets' || process.env.NODE_ENV !== 'production') {
    return;
  }

  const { sheets } = await getAuthenticatedSheetsClient();
  const spreadsheetId = await ensureDailySpreadsheet();
  const now = new Date().toISOString();

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Run Checks!A:E',
      valueInputOption: 'RAW',
      requestBody: {
        values: [[
          now,
          check.checkTime.toISOString(),
          check.section,
          check.runName,
          check.patroller,
        ]],
      },
    });
  } catch (error) {
    logger.error('Error appending check to spreadsheet:', error);
    throw error;
  }
}
