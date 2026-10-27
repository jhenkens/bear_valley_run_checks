import fs from 'fs';
import { appConfig } from '../config/config';
import { logger } from '../utils/logger';
import { getAuthenticatedSheetsClient } from './googleOAuth';
import { getSeasonStartYear, formatDateInTimezone } from './googleSheets';

// Archived board items are appended to a per-season "Patrol Board" spreadsheet (one "Archive" tab,
// filter it in Sheets to browse old items), with photos copied into a sibling Drive folder.

const ARCHIVE_TAB = 'Archive';
const ARCHIVE_HEADERS = [
  'Created', 'Author', 'Section', 'Description', 'Task', 'Assignee', 'Due', 'Due Time', 'Done At', 'Done By',
  'Debrief Date', 'Morning Brief Date', 'Archived At', 'Photos',
];
const LAST_COLUMN = String.fromCharCode('A'.charCodeAt(0) + ARCHIVE_HEADERS.length - 1);

export interface ArchivableItem {
  description: string;
  section: string;
  authorName: string;
  createdAt: Date;
  isTask: boolean;
  dueDate: string | null;
  dueHour: number | null;
  assignee: string | null;
  doneAt: Date | null;
  doneBy: string | null;
  debriefDate: string | null;
  morningBriefDate: string | null;
  archivedAt: Date | null;
}

// Cached per season name, like the run-check season spreadsheet
let cachedSheet = { season: '', id: '' };
let cachedPhotoFolder = { season: '', id: '' };

function seasonLabel(): string {
  const startYear = getSeasonStartYear();
  return `${startYear}-${startYear + 1}`;
}

export function archiveEnabled(): boolean {
  return appConfig.runProvider === 'sheets';
}

async function findOrCreateByName(
  name: string,
  mimeType: string,
  create: (folderId: string) => Promise<string>,
): Promise<string> {
  const { drive, folderId } = await getAuthenticatedSheetsClient();
  if (!folderId) {
    throw new Error('Google Drive folder not configured. Please select a folder in admin settings.');
  }

  const found = await drive.files.list({
    q: `name='${name}' and '${folderId}' in parents and mimeType='${mimeType}' and trashed=false`,
    fields: 'files(id)',
    spaces: 'drive',
  });
  const existing = found.data.files?.[0]?.id;
  return existing || create(folderId);
}

async function ensureArchiveSpreadsheet(): Promise<string> {
  const season = seasonLabel();
  if (cachedSheet.season === season) return cachedSheet.id;

  const id = await findOrCreateByName(
    `${season} Patrol Board`,
    'application/vnd.google-apps.spreadsheet',
    async (folderId) => {
      const { sheets, drive } = await getAuthenticatedSheetsClient();
      const created = await drive.files.create({
        requestBody: {
          name: `${season} Patrol Board`,
          mimeType: 'application/vnd.google-apps.spreadsheet',
          parents: [folderId],
        },
        fields: 'id',
      });
      const newId = created.data.id;
      if (!newId) throw new Error('Failed to create Patrol Board spreadsheet: no ID returned');

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: newId,
        requestBody: {
          requests: [{
            updateSheetProperties: {
              properties: { sheetId: 0, title: ARCHIVE_TAB, gridProperties: { frozenRowCount: 1 } },
              fields: 'title,gridProperties.frozenRowCount',
            },
          }],
        },
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId: newId,
        range: `${ARCHIVE_TAB}!A1:${LAST_COLUMN}1`,
        valueInputOption: 'RAW',
        requestBody: { values: [ARCHIVE_HEADERS] },
      });
      logger.info(`Created Patrol Board archive spreadsheet for ${season} (${newId})`);
      return newId;
    },
  );

  cachedSheet = { season, id };
  return id;
}

async function ensurePhotoFolder(): Promise<string> {
  const season = seasonLabel();
  if (cachedPhotoFolder.season === season) return cachedPhotoFolder.id;

  const id = await findOrCreateByName(
    `${season} Patrol Board Photos`,
    'application/vnd.google-apps.folder',
    async (folderId) => {
      const { drive } = await getAuthenticatedSheetsClient();
      const created = await drive.files.create({
        requestBody: {
          name: `${season} Patrol Board Photos`,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [folderId],
        },
        fields: 'id',
      });
      if (!created.data.id) throw new Error('Failed to create photo folder: no ID returned');
      return created.data.id;
    },
  );

  cachedPhotoFolder = { season, id };
  return id;
}

/**
 * Copy one local photo into the Drive photo folder.
 */
export async function uploadPhotoToDrive(
  localPath: string,
  fileName: string,
): Promise<{ fileId: string; url: string }> {
  const parent = await ensurePhotoFolder();
  const { drive } = await getAuthenticatedSheetsClient();
  const created = await drive.files.create({
    requestBody: { name: fileName, parents: [parent] },
    media: { mimeType: 'image/jpeg', body: fs.createReadStream(localPath) },
    fields: 'id, webViewLink',
  });
  if (!created.data.id) throw new Error('Failed to upload photo: no ID returned');
  return {
    fileId: created.data.id,
    url: created.data.webViewLink || `https://drive.google.com/file/d/${created.data.id}/view`,
  };
}

function fmt(date: Date | null): string {
  return date ? formatDateInTimezone(date) : '';
}

export async function appendArchiveRow(item: ArchivableItem, photoUrls: string[]): Promise<void> {
  const spreadsheetId = await ensureArchiveSpreadsheet();
  const { sheets } = await getAuthenticatedSheetsClient();

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${ARCHIVE_TAB}!A:${LAST_COLUMN}`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[
        fmt(item.createdAt),
        item.authorName,
        item.section,
        item.description,
        item.isTask ? 'Yes' : '',
        item.assignee || '',
        item.dueDate || '',
        item.dueDate ? (item.dueHour == null ? 'End of day' : `${item.dueHour}:00`) : '',
        fmt(item.doneAt),
        item.doneBy || '',
        item.debriefDate || '',
        item.morningBriefDate || '',
        fmt(item.archivedAt),
        photoUrls.join('\n'),
      ]],
    },
  });
}
