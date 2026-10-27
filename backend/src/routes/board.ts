import express, { Router, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { createRunProvider } from '../providers';
import { requireAuth, AuthRequest } from '../auth/middleware';
import { getPrismaClient } from '../config/database';
import { getTodaySheetName } from '../services/googleSheets';
import {
  MAX_PHOTOS_PER_ITEM,
  listActiveItems,
  toApiItem,
  isPinDate,
  photoPath,
  deletePhotoFiles,
  copyItem,
  CopyTarget,
} from '../services/boardService';
import { auditBoard, auditSnapshot, auditDiff } from '../services/boardAudit';
import { logger } from '../utils/logger';

const router = Router();
router.use(requireAuth);

const DEFAULT_SECTION = 'General';
const MAX_DESCRIPTION = 1000;
const MAX_NAME = 100;
// Due times are whole hours from 8 AM to 4 PM; no hour means end of day (5 PM)
const MIN_DUE_HOUR = 8;
const MAX_DUE_HOUR = 16;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

function isValidDate(value: unknown): value is string {
  return typeof value === 'string' && DATE_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function notifyChanged(req: AuthRequest): void {
  req.app.get('io')?.emit('board:changed');
}

interface ItemChanges {
  description?: string;
  section?: string;
  isTask?: boolean;
  dueDate?: string | null;
  dueHour?: number | null;
  assignee?: string | null;
  debriefDate?: string | null;
  morningBriefDate?: string | null;
}

/**
 * Validate the editable fields shared by create and update. Returns an error message, or the
 * changes to apply. Pins arrive as booleans and become dates relative to today.
 */
function parseChanges(body: any): { error: string } | { changes: ItemChanges } {
  const changes: ItemChanges = {};

  if (body.description !== undefined) {
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (!description) return { error: 'Description is required' };
    if (description.length > MAX_DESCRIPTION) return { error: `Description must be ${MAX_DESCRIPTION} characters or fewer` };
    changes.description = description;
  }

  if (body.section !== undefined) {
    const section = typeof body.section === 'string' ? body.section.trim() : '';
    if (!section || section.length > MAX_NAME) return { error: 'Invalid section' };
    changes.section = section;
  }

  if (body.dueDate !== undefined) {
    if (body.dueDate !== null && !isValidDate(body.dueDate)) return { error: 'Invalid due date' };
    changes.dueDate = body.dueDate;
  }

  if (body.dueHour !== undefined) {
    if (body.dueHour !== null && !(Number.isInteger(body.dueHour) && body.dueHour >= MIN_DUE_HOUR && body.dueHour <= MAX_DUE_HOUR)) {
      return { error: 'Invalid due time' };
    }
    changes.dueHour = body.dueHour;
  }

  if (body.assignee !== undefined) {
    if (body.assignee !== null) {
      const assignee = typeof body.assignee === 'string' ? body.assignee.trim() : '';
      if (!assignee || assignee.length > MAX_NAME) return { error: 'Invalid assignee' };
      changes.assignee = assignee;
    } else {
      changes.assignee = null;
    }
  }

  if (body.isTask === true) changes.isTask = true;

  // Pins are explicit days (today up to a week ahead), or null to unpin
  if (body.debriefDate !== undefined) {
    if (body.debriefDate !== null && !isPinDate(body.debriefDate)) return { error: 'Invalid debrief date' };
    changes.debriefDate = body.debriefDate;
  }
  if (body.morningBriefDate !== undefined) {
    if (body.morningBriefDate !== null && !isPinDate(body.morningBriefDate)) return { error: 'Invalid morning brief date' };
    changes.morningBriefDate = body.morningBriefDate;
  }

  // Giving an item an assignee or due date/time makes it a task
  if (changes.assignee || changes.dueDate || changes.dueHour != null) changes.isTask = true;

  return { changes };
}

// GET /api/board - Active items, plus what the form needs
router.get('/', async (_req, res) => {
  try {
    const provider = createRunProvider();
    await provider.initialize();
    const runSections = [...new Set(provider.getRuns().map(run => run.section))];

    const items = await listActiveItems();
    res.json({
      items: items.map(toApiItem),
      sections: [DEFAULT_SECTION, ...runSections.filter(s => s !== DEFAULT_SECTION)],
      today: getTodaySheetName(),
    });
  } catch (error) {
    logger.error('Error fetching board:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/board - Create an item. With only a description it's a task, due end of day today.
router.post('/', async (req: AuthRequest, res) => {
  try {
    const parsed = parseChanges(req.body);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    const { changes } = parsed;
    if (!changes.description) return res.status(400).json({ error: 'Description is required' });

    // An item has to live somewhere or it would be archived before anyone saw it, so one with
    // no task flag and no pins becomes a task
    if (!changes.isTask && !changes.debriefDate && !changes.morningBriefDate) changes.isTask = true;
    if (changes.isTask && !changes.dueDate) changes.dueDate = getTodaySheetName(); // "ASAP" = due today

    const item = await getPrismaClient().boardItem.create({
      data: {
        ...changes,
        description: changes.description,
        authorName: req.user!.name,
        authorId: req.user!.id,
      },
      include: { photos: { select: { id: true } } },
    });

    auditBoard(req, 'item.create', { itemId: item.id, item: auditSnapshot(item) });
    notifyChanged(req);
    res.status(201).json({ item: toApiItem(item) });
  } catch (error) {
    logger.error('Error creating board item:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/board/:id - Edit fields, change pins, or mark a task done/open ({ done: boolean })
router.patch('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params as { id: string };
    const prisma = getPrismaClient();
    const existing = await prisma.boardItem.findUnique({ where: { id: id } });
    if (!existing || existing.archivedAt) return res.status(404).json({ error: 'Item not found' });

    const parsed = parseChanges(req.body);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    const { changes } = parsed;

    const data: Record<string, unknown> = { ...changes };
    if (changes.dueDate === null) {
      data.dueHour = null;
    } else if (changes.isTask && !existing.dueDate && !changes.dueDate) {
      data.dueDate = getTodaySheetName(); // "ASAP" = due today
    }

    if (typeof req.body.done === 'boolean') {
      if (!existing.isTask && !changes.isTask) return res.status(400).json({ error: 'Only tasks can be marked done' });
      data.doneAt = req.body.done ? new Date() : null;
      data.doneBy = req.body.done ? req.user!.name : null;
    }

    const item = await prisma.boardItem.update({
      where: { id: existing.id },
      data,
      include: { photos: { select: { id: true }, orderBy: { createdAt: 'asc' } } },
    });

    const diff = auditDiff(existing, item);
    if (Object.keys(diff).length > 0) auditBoard(req, 'item.update', { itemId: item.id, changes: diff });
    notifyChanged(req);
    res.json({ item: toApiItem(item) });
  } catch (error) {
    logger.error('Error updating board item:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/board/:id/copy - New item from this one:
//   { to: 'tasks', assignee?, dueDate?, dueHour? } or { to: 'debrief' | 'brief', date? } (date defaults to today / tomorrow)
router.post('/:id/copy', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params as { id: string };
    const to = req.body.to as CopyTarget;
    if (to !== 'tasks' && to !== 'debrief' && to !== 'brief') return res.status(400).json({ error: 'Invalid destination' });

    if (to !== 'tasks' && req.body.date !== undefined && !isPinDate(req.body.date)) {
      return res.status(400).json({ error: 'Invalid date' });
    }

    // Assignee and due date only mean something for a task
    const parsed = parseChanges(to === 'tasks'
      ? { assignee: req.body.assignee, dueDate: req.body.dueDate, dueHour: req.body.dueHour }
      : {});
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });

    const copy = await copyItem(id, {
      to,
      date: to === 'tasks' ? undefined : req.body.date,
      author: { id: req.user!.id, name: req.user!.name },
      assignee: parsed.changes.assignee,
      dueDate: parsed.changes.dueDate,
      dueHour: parsed.changes.dueHour,
    });
    if (!copy) return res.status(404).json({ error: 'Item not found' });

    auditBoard(req, 'item.copy', { itemId: copy.id, copiedFrom: id, to, item: auditSnapshot(copy) });
    notifyChanged(req);
    res.status(201).json({ item: toApiItem(copy) });
  } catch (error) {
    logger.error('Error copying board item:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/board/:id - Author or admin
router.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params as { id: string };
    const prisma = getPrismaClient();
    const existing = await prisma.boardItem.findUnique({ where: { id: id } });
    if (!existing || existing.archivedAt) return res.status(404).json({ error: 'Item not found' });
    if (existing.authorId !== req.user!.id && !req.user!.isAdmin) {
      auditBoard(req, 'item.delete.denied', { itemId: existing.id });
      return res.status(403).json({ error: 'Only the author or an admin can delete this' });
    }

    const photoCount = await prisma.boardPhoto.count({ where: { itemId: existing.id } });
    await prisma.boardItem.delete({ where: { id: existing.id } });
    await deletePhotoFiles(existing.id);

    // The snapshot is what makes a deleted item recoverable from the log
    auditBoard(req, 'item.delete', { itemId: existing.id, item: { ...auditSnapshot(existing), photoCount } });

    notifyChanged(req);
    res.json({ message: 'Deleted' });
  } catch (error) {
    logger.error('Error deleting board item:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/board/:id/photos - Attach a JPEG (the client downsizes it first)
router.post('/:id/photos', express.raw({ type: 'image/jpeg', limit: '2mb' }), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params as { id: string };
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length < JPEG_MAGIC.length || !body.subarray(0, 3).equals(JPEG_MAGIC)) {
      return res.status(400).json({ error: 'A JPEG image is required' });
    }

    const prisma = getPrismaClient();
    const item = await prisma.boardItem.findUnique({
      where: { id: id },
      include: { _count: { select: { photos: true } } },
    });
    if (!item || item.archivedAt) return res.status(404).json({ error: 'Item not found' });
    if (item._count.photos >= MAX_PHOTOS_PER_ITEM) {
      return res.status(400).json({ error: `At most ${MAX_PHOTOS_PER_ITEM} photos per item` });
    }

    const photo = await prisma.boardPhoto.create({
      data: { itemId: item.id, uploadedBy: req.user!.id },
    });
    const file = photoPath(item.id, photo.id);
    try {
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      await fs.promises.writeFile(file, body);
    } catch (error) {
      await prisma.boardPhoto.delete({ where: { id: photo.id } });
      throw error;
    }

    auditBoard(req, 'photo.upload', { itemId: item.id, photoId: photo.id, bytes: body.length });
    notifyChanged(req);
    res.status(201).json({ photo: { id: photo.id } });
  } catch (error) {
    logger.error('Error uploading board photo:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/board/photos/:photoId - Stream a photo; only signed-in users, never public
router.get('/photos/:photoId', async (req, res) => {
  try {
    const { photoId } = req.params as { photoId: string };
    const photo = await getPrismaClient().boardPhoto.findUnique({ where: { id: photoId } });
    if (!photo) return res.status(404).json({ error: 'Photo not found' });

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const stream = fs.createReadStream(photoPath(photo.itemId, photo.id));
    stream.on('error', () => {
      if (!res.headersSent) res.status(404).json({ error: 'Photo not found' });
      else res.destroy();
    });
    stream.pipe(res);
  } catch (error) {
    logger.error('Error serving board photo:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/board/photos/:photoId - Uploader or admin
router.delete('/photos/:photoId', async (req: AuthRequest, res) => {
  try {
    const { photoId } = req.params as { photoId: string };
    const prisma = getPrismaClient();
    const photo = await prisma.boardPhoto.findUnique({
      where: { id: photoId },
      include: { item: { select: { archivedAt: true } } },
    });
    if (!photo || photo.item.archivedAt) return res.status(404).json({ error: 'Photo not found' });
    if (photo.uploadedBy !== req.user!.id && !req.user!.isAdmin) {
      auditBoard(req, 'photo.delete.denied', { itemId: photo.itemId, photoId: photo.id });
      return res.status(403).json({ error: 'Only the uploader or an admin can delete this' });
    }

    await prisma.boardPhoto.delete({ where: { id: photo.id } });
    await fs.promises.rm(photoPath(photo.itemId, photo.id), { force: true });
    auditBoard(req, 'photo.delete', { itemId: photo.itemId, photoId: photo.id });

    notifyChanged(req);
    res.json({ message: 'Deleted' });
  } catch (error) {
    logger.error('Error deleting board photo:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
