import fs from 'fs';
import path from 'path';
import { formatInTimeZone } from 'date-fns-tz';
import { appConfig } from '../config/config';
import { logger } from '../utils/logger';
import type { AuthRequest } from '../auth/middleware';

// Append-only record of every change to the board: one JSON object per line, one file per month
// under data/board-audit/ (a Docker volume in production). Read it with tail/grep/jq.
const AUDIT_DIR = path.resolve('./data/board-audit');

const TRACKED_FIELDS = [
  'description', 'section', 'isTask', 'dueDate', 'dueHour', 'assignee', 'doneAt', 'doneBy',
  'debriefDate', 'morningBriefDate',
] as const;

type Snapshot = Record<string, unknown>;

export interface AuditItem {
  id: string;
  description: string;
  section: string;
  isTask: boolean;
  dueDate: string | null;
  dueHour: number | null;
  assignee: string | null;
  doneAt: Date | null;
  doneBy: string | null;
  debriefDate: string | null;
  morningBriefDate: string | null;
  authorName?: string;
  photos?: unknown[];
}

export function auditSnapshot(item: AuditItem): Snapshot {
  const snapshot: Snapshot = {};
  for (const field of TRACKED_FIELDS) {
    const value = item[field];
    snapshot[field] = value instanceof Date ? value.toISOString() : value;
  }
  if (item.authorName !== undefined) snapshot.authorName = item.authorName;
  if (item.photos) snapshot.photoCount = item.photos.length;
  return snapshot;
}

/** Only the tracked fields that differ, as { field: { from, to } }. */
export function auditDiff(before: AuditItem, after: AuditItem): Record<string, { from: unknown; to: unknown }> {
  const from = auditSnapshot(before);
  const to = auditSnapshot(after);
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of TRACKED_FIELDS) {
    if (from[field] !== to[field]) changes[field] = { from: from[field], to: to[field] };
  }
  return changes;
}

// Writes are queued so lines from concurrent requests never interleave
let queue: Promise<void> = Promise.resolve();

/**
 * Record a board event. `req` is the request that caused it, or null for something the system did
 * (the archive sweep). Never throws: a failing log must not fail the change itself.
 */
export function auditBoard(
  req: AuthRequest | null,
  action: string,
  details: Record<string, unknown> = {},
): void {
  const now = new Date();
  const entry = {
    ts: now.toISOString(),
    time: formatInTimeZone(now, appConfig.timezone, 'yyyy-MM-dd HH:mm:ss zzz'),
    action,
    actor: req?.user
      ? { id: req.user.id, name: req.user.name, email: req.user.email }
      : 'system',
    ...(req ? { ip: req.ip, userAgent: req.get('user-agent') } : {}),
    ...details,
  };
  const file = path.join(AUDIT_DIR, `board-audit-${formatInTimeZone(now, appConfig.timezone, 'yyyy-MM')}.log`);

  queue = queue
    .then(async () => {
      await fs.promises.mkdir(AUDIT_DIR, { recursive: true });
      await fs.promises.appendFile(file, JSON.stringify(entry) + '\n');
    })
    .catch(error => {
      logger.error('Failed to write board audit log:', error);
    });
}
