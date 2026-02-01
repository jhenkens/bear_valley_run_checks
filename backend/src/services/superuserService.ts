import { getPrismaClient } from '../config/database';
import { appConfig } from '../config/config';
import { logger } from '../utils/logger';

/**
 * Syncs superusers from config.yaml to database
 * - Creates new superusers if they don't exist
 * - Updates names of existing superusers
 * - Sets isAdmin to true for all superusers
 */
export async function syncSuperusers(): Promise<void> {
  const prisma = getPrismaClient();

  logger.info(`Syncing ${appConfig.superusers.length} superusers from config...`);

  for (const superuser of appConfig.superusers) {
    try {
      const existing = await prisma.user.findUnique({
        where: { email: superuser.email },
      });

      if (existing) {
        // Update existing superuser
        await prisma.user.update({
          where: { email: superuser.email },
          data: {
            name: superuser.name,
            isAdmin: true,
          },
        });
        logger.debug(`  ✓ Updated superuser: ${superuser.email}`);
      } else {
        // Create new superuser
        await prisma.user.create({
          data: {
            email: superuser.email,
            name: superuser.name,
            isAdmin: true,
          },
        });
        logger.info(`  ✓ Created superuser: ${superuser.email}`);
      }
    } catch (error) {
      logger.error(`  ✗ Failed to sync superuser ${superuser.email}:`, error);
    }
  }
}

export function isSuperuser(email: string | null): boolean {
  if (!email) return false;
  return appConfig.superusers.some(su => su.email === email);
}

export function getSuperuserEmails(): string[] {
  return appConfig.superusers.map(su => su.email);
}
