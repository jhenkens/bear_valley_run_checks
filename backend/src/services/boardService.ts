import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import { formatInTimeZone } from 'date-fns-tz';
import { getPrismaClient } from '../config/database';
import { appConfig } from '../config/config';
import { logger } from '../utils/logger';
import { getTodaySheetName, addDaysToDateString } from './googleSheets';
import { archiveEnabled, appendArchiveRow, uploadPhotoToDrive } from './boardArchive';
import { auditBoard, auditSnapshot } from './boardAudit';

export const MAX_PHOTOS_PER_ITEM = 3;

const PHOTO_ROOT = path.resolve('./data/board-photos');

export function photoPath(itemId: string, photoId: string): string {
  return path.join(PHOTO_ROOT, itemId, `${photoId}.jpg`);
}

export function tomorrowString(): string {
  return addDaysToDateString(getTodaySheetName(), 1);
}

// Pins can be set for today or up to a week ahead
const PIN_WINDOW_DAYS = 7;

export function isPinDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    return false;
  }
  const today = getTodaySheetName();
  return value >= today && value <= addDaysToDateString(today, PIN_WINDOW_DAYS);
}

interface ActivityFields {
  isTask: boolean;
  doneAt: Date | null;
  debriefDate: string | null;
  morningBriefDate: string | null;
}

/**
 * An item stays on the board while it's pinned for today's debrief, queued for a morning brief
 * that hasn't passed yet, or is a task that's still open (or was finished today). Everything
 * else is archived by the next sweep.
 */
export function isActive(item: ActivityFields, today: string): boolean {
  if (item.debriefDate && item.debriefDate >= today) return true; // today's, or queued for a later day
  if (item.morningBriefDate && item.morningBriefDate >= today) return true;
  if (item.isTask) {
    return !item.doneAt || formatInTimeZone(item.doneAt, appConfig.timezone, 'yyyy-MM-dd') === today;
  }
  return false;
}

export async function listActiveItems() {
  const prisma = getPrismaClient();
  const today = getTodaySheetName();
  const items = await prisma.boardItem.findMany({
    where: { archivedAt: null },
    include: { photos: { select: { id: true }, orderBy: { createdAt: 'asc' } } },
    orderBy: { createdAt: 'asc' },
  });
  return items.filter(item => isActive(item, today));
}

export function toApiItem(item: Awaited<ReturnType<typeof listActiveItems>>[number]) {
  return {
    id: item.id,
    description: item.description,
    section: item.section,
    authorName: item.authorName,
    authorId: item.authorId,
    createdAt: Math.floor(item.createdAt.getTime() / 1000),
    isTask: item.isTask,
    dueDate: item.dueDate,
    dueHour: item.dueHour,
    assignee: item.assignee,
    doneAt: item.doneAt ? Math.floor(item.doneAt.getTime() / 1000) : null,
    doneBy: item.doneBy,
    debriefDate: item.debriefDate,
    morningBriefDate: item.morningBriefDate,
    photos: item.photos.map(p => p.id),
  };
}

export type CopyTarget = 'tasks' | 'debrief' | 'brief';

export interface CopyOptions {
  to: CopyTarget;
  date?: string; // the day to pin a debrief or morning-brief copy to
  author: { id: string; name: string };
  assignee?: string | null;
  dueDate?: string | null;
  dueHour?: number | null;
}

/**
 * Make a new item from an existing one (description, section and photos), leaving the original where
 * it is. The copy is a task, a debrief note or a morning-brief note depending on `to`.
 */
export async function copyItem(sourceId: string, options: CopyOptions) {
  const prisma = getPrismaClient();
  const source = await prisma.boardItem.findUnique({ where: { id: sourceId }, include: { photos: true } });
  if (!source || source.archivedAt) return null;

  const data = {
    description: source.description,
    section: source.section,
    authorName: options.author.name,
    authorId: options.author.id,
  };
  const target =
    options.to === 'tasks'
      ? {
          isTask: true,
          dueDate: options.dueDate || getTodaySheetName(), // "ASAP" = due today
          dueHour: options.dueDate ? options.dueHour ?? null : null,
          assignee: options.assignee || null,
        }
      : options.to === 'debrief'
        ? { debriefDate: options.date || getTodaySheetName() }
        : { morningBriefDate: options.date || tomorrowString() };

  const copy = await prisma.boardItem.create({ data: { ...data, ...target } });

  for (const photo of source.photos) {
    const copied = await prisma.boardPhoto.create({ data: { itemId: copy.id, uploadedBy: options.author.id } });
    try {
      await fs.promises.mkdir(path.dirname(photoPath(copy.id, copied.id)), { recursive: true });
      await fs.promises.copyFile(photoPath(source.id, photo.id), photoPath(copy.id, copied.id));
    } catch (error) {
      // A missing source file shouldn't fail the whole copy
      logger.warn(`Could not copy photo ${photo.id} to board item ${copy.id}:`, error);
      await prisma.boardPhoto.delete({ where: { id: copied.id } });
    }
  }

  return prisma.boardItem.findUniqueOrThrow({
    where: { id: copy.id },
    include: { photos: { select: { id: true }, orderBy: { createdAt: 'asc' } } },
  });
}

export async function deletePhotoFiles(itemId: string): Promise<void> {
  await fs.promises.rm(path.join(PHOTO_ROOT, itemId), { recursive: true, force: true });
}

// --- Archiving ---------------------------------------------------------------------------------

let sweeping = false;

/**
 * Mark inactive items archived, then copy any archived-but-unwritten items (and their photos) to
 * the archive spreadsheet. Safe to call repeatedly; a failed copy is retried on the next sweep.
 */
export async function archiveInactive(): Promise<void> {
  if (sweeping) return;
  sweeping = true;
  try {
    const prisma = getPrismaClient();
    const today = getTodaySheetName();

    const open = await prisma.boardItem.findMany({ where: { archivedAt: null } });
    const staleIds = open.filter(item => !isActive(item, today)).map(item => item.id);
    if (staleIds.length > 0) {
      await prisma.boardItem.updateMany({
        where: { id: { in: staleIds } },
        data: { archivedAt: new Date() },
      });
      for (const item of open.filter(item => staleIds.includes(item.id))) {
        auditBoard(null, 'item.archive', { itemId: item.id, item: auditSnapshot(item) });
      }
      logger.info(`Archived ${staleIds.length} board item(s)`);
    }

    if (!archiveEnabled()) return;

    const pending = await prisma.boardItem.findMany({
      where: { archivedAt: { not: null }, archivedToSheet: false },
      include: { photos: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    });

    for (const item of pending) {
      try {
        const photoUrls: string[] = [];
        for (const [index, photo] of item.photos.entries()) {
          let url = photo.driveUrl;
          if (!url) {
            const uploaded = await uploadPhotoToDrive(
              photoPath(item.id, photo.id),
              `${item.createdAt.toISOString().slice(0, 10)}-${item.id}-${index + 1}.jpg`,
            );
            url = uploaded.url;
            await prisma.boardPhoto.update({
              where: { id: photo.id },
              data: { driveFileId: uploaded.fileId, driveUrl: uploaded.url },
            });
          }
          photoUrls.push(url);
        }
        await appendArchiveRow(item, photoUrls);
        await prisma.boardItem.update({ where: { id: item.id }, data: { archivedToSheet: true } });
        auditBoard(null, 'item.archive.sheet', { itemId: item.id, photos: photoUrls.length });
      } catch (error) {
        // Leave it unwritten; the next sweep retries. Later items may still succeed.
        logger.error(`Failed to archive board item ${item.id} to Google Sheets:`, error);
        auditBoard(null, 'item.archive.sheet.failed', { itemId: item.id, error: String(error) });
      }
    }
  } finally {
    sweeping = false;
  }
}

export function startBoardScheduler(): void {
  const run = () => archiveInactive().catch(error => logger.error('Board archive sweep failed:', error));
  run();
  cron.schedule('10 * * * *', run, {
    name: 'board-archive-sweep',
    timezone: appConfig.timezone,
    noOverlap: true,
  });
  logger.info(`Scheduled hourly board archive sweep (10 minutes past every hour, timezone: ${appConfig.timezone})`);
}
