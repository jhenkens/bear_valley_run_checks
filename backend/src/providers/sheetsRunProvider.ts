import { IRunProvider } from './runProvider';
import { Run } from '../config/config';
import { logger } from '../utils/logger';
import { getSheetsClient, getSourceSpreadsheetId } from '../services/googleSheets';

export class SheetsRunProvider implements IRunProvider {
  private runs: Run[] = [];

  async initialize(): Promise<void> {
    // In development mode, return empty runs array
    if (process.env.NODE_ENV !== 'production') {
      logger.info('SheetsRunProvider initialized (skipped in development)');
      return;
    }

    try {
      const sheets = getSheetsClient();
      const spreadsheetId = getSourceSpreadsheetId();

      if (!sheets || !spreadsheetId) {
        throw new Error('Google Sheets not initialized. Call initializeGoogleSheets() first.');
      }

      // Get the first sheet to read run data
      const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId,
      });

      const firstSheet = spreadsheet.data.sheets?.[0]?.properties?.title || 'Sheet1';
      
      // Read all data from the first sheet
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${firstSheet}`,
      });

      const rows = response.data.values || [];
      
      if (rows.length === 0) {
        logger.warn('No data found in source spreadsheet');
        return;
      }

      // Find column indices for "Section" and "Run Name"
      const headerRow = rows[0];
      const sectionIndex = headerRow.findIndex((col: string) => 
        col.toLowerCase().trim() === 'section'
      );
      const runNameIndex = headerRow.findIndex((col: string) => 
        col.toLowerCase().trim() === 'run name'
      );

      if (sectionIndex === -1 || runNameIndex === -1) {
        throw new Error(
          `Required columns not found. Expected "Section" and "Run Name" columns. ` +
          `Found: ${headerRow.join(', ')}`
        );
      }

      // Parse data rows (skip header)
      this.runs = [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const section = row[sectionIndex]?.trim();
        const name = row[runNameIndex]?.trim();

        // Skip empty rows
        if (!section || !name) {
          continue;
        }

        this.runs.push({
          section,
          name,
        });
      }

      logger.info(`SheetsRunProvider initialized with ${this.runs.length} runs from spreadsheet`);
    } catch (error) {
      logger.error('Error loading runs from Google Sheets:', error);
      throw error;
    }
  }

  getRuns(): Run[] {
    return this.runs;
  }
}
