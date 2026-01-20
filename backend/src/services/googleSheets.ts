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
let spreadsheetId: string = '';

export async function initializeGoogleSheets(): Promise<void> {
  // Skip in development mode
  if (process.env.NODE_ENV !== 'production') {
    logger.debug('Skipping Google Sheets initialization in development mode');
    return;
  }

  if (appConfig.runProvider !== 'sheets') {
    return;
  }

  if (!appConfig.env.googleSheetsId || !appConfig.env.googleServiceAccountEmail || !appConfig.env.googlePrivateKey) {
    throw new Error('Google Sheets credentials not configured');
  }

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: appConfig.env.googleServiceAccountEmail,
      private_key: appConfig.env.googlePrivateKey.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  sheets = google.sheets({ version: 'v4', auth });
  spreadsheetId = appConfig.env.googleSheetsId;

  logger.info('Google Sheets API initialized');
}

function getTodaySheetName(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

export async function ensureDailySheet(): Promise<string> {
  const sheetName = getTodaySheetName();

  try {
    // Check if sheet exists
    const response = await sheets.spreadsheets.get({
      spreadsheetId,
    });

    const sheetExists = response.data.sheets?.some(
      (sheet: any) => sheet.properties.title === sheetName
    );

    if (!sheetExists) {
      // Create new sheet with headers
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: sheetName,
                },
              },
            },
          ],
        },
      });

      // Add headers
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A1:E1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [['Timestamp', 'Check Time', 'Section', 'Run Name', 'Patroller']],
        },
      });

      logger.info(`Created daily sheet: ${sheetName}`);
    }

    return sheetName;
  } catch (error) {
    logger.error('Error ensuring daily sheet:', error);
    throw error;
  }
}

export async function loadTodayChecks(): Promise<RunCheck[]> {
  if (appConfig.runProvider !== 'sheets' || process.env.NODE_ENV !== 'production') {
    return [];
  }

  const sheetName = getTodaySheetName();

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A2:E`,
    });

    const rows = response.data.values || [];
    return rows.map((row: string[], index: number) => ({
      id: `${sheetName}-${index}`,
      runName: row[3] || '',
      section: row[2] || '',
      patroller: row[4] || '',
      checkTime: new Date(row[1] || row[0]),
      createdAt: new Date(row[0]),
    }));
  } catch (error) {
    logger.error('Error loading checks from sheet:', error);
    return [];
  }
}

export async function appendRunCheck(check: Omit<RunCheck, 'id' | 'createdAt'>): Promise<void> {
  if (appConfig.runProvider !== 'sheets' || process.env.NODE_ENV !== 'production') {
    return;
  }

  const sheetName = await ensureDailySheet();
  const now = new Date().toISOString();

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:E`,
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
    logger.error('Error appending check to sheet:', error);
    throw error;
  }
}
