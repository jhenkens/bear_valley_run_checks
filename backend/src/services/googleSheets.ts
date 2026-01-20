import { google } from 'googleapis';
import { appConfig } from '../config/config';
import { logger } from '../utils/logger';

export interface RunCheck {
  id: string;
  runName: string;
  section: string;
  patroller: string;
  checkTime: Date;
  createdAt: Date;
}

let sheets: any = null;
let drive: any = null;
let sourceSpreadsheetId: string = ''; // Source of truth for run names
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

  if (!appConfig.googleSheetsId || !appConfig.googleDriveFolderId || !appConfig.googleServiceAccountEmail || !appConfig.googlePrivateKey) {
    logger.error('Google Sheets/Drive credentials not configured:', {
      hasGoogleSheetsId: !!appConfig.googleSheetsId,
      googleSheetsId: appConfig.googleSheetsId || 'NOT SET',
      hasGoogleDriveFolderId: !!appConfig.googleDriveFolderId,
      googleDriveFolderId: appConfig.googleDriveFolderId || 'NOT SET',
      hasGoogleServiceAccountEmail: !!appConfig.googleServiceAccountEmail,
      googleServiceAccountEmail: appConfig.googleServiceAccountEmail || 'NOT SET',
      hasGooglePrivateKey: !!appConfig.googlePrivateKey,
    });
    throw new Error('Google Sheets/Drive credentials not configured');
  }

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: appConfig.googleServiceAccountEmail,
      private_key: appConfig.googlePrivateKey.replace(/\\n/g, '\n'),
    },
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive'
    ],
  });

  sheets = google.sheets({ version: 'v4', auth });
  drive = google.drive({ version: 'v3', auth });
  sourceSpreadsheetId = appConfig.googleSheetsId;

  logger.info('Google Sheets and Drive API initialized');
  logger.info(`Source spreadsheet: ${sourceSpreadsheetId}`);
  logger.info(`Daily spreadsheets folder: ${appConfig.googleDriveFolderId}`);
}

function getTodaySheetName(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

// Helper functions for other services
export function getSheetsClient(): any {
  return sheets;
}

export function getSourceSpreadsheetId(): string {
  return sourceSpreadsheetId;
}

export async function ensureDailySpreadsheet(): Promise<string> {
  const today = getTodaySheetName();
  
  // Check if we already have today's spreadsheet ID cached
  if (dailySpreadsheetId && dailySpreadsheetDate === today) {
    return dailySpreadsheetId;
  }

  try {
    // Search for existing spreadsheet in the folder
    const searchResponse = await drive.files.list({
      q: `name='${today}' and '${appConfig.googleDriveFolderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
      fields: 'files(id, name)',
      spaces: 'drive',
    });

    if (searchResponse.data.files && searchResponse.data.files.length > 0) {
      // Found existing spreadsheet
      dailySpreadsheetId = searchResponse.data.files[0].id;
      dailySpreadsheetDate = today;
      logger.info(`Found existing daily spreadsheet: ${today} (${dailySpreadsheetId})`);
      return dailySpreadsheetId;
    }

    // Create new spreadsheet
    const createResponse = await sheets.spreadsheets.create({
      requestBody: {
        properties: {
          title: today,
        },
        sheets: [
          {
            properties: {
              title: 'Run Checks',
            },
          },
        ],
      },
    });

    const newSpreadsheetId = createResponse.data.spreadsheetId;

    // Move to the specified folder
    await drive.files.update({
      fileId: newSpreadsheetId,
      addParents: appConfig.googleDriveFolderId,
      fields: 'id, parents',
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

    dailySpreadsheetId = newSpreadsheetId!;
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
    const response = await sheets.spreadsheets.values.get({
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
