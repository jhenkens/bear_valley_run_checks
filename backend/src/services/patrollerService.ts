import { getPrismaClient } from '../config/database';
import { config } from '../config/config';
import { isSuperuser } from './superuserService';

export async function getAllPatrollers(): Promise<string[]> {
  const prisma = getPrismaClient();
  const users = await prisma.user.findMany({
    select: { name: true },
  });

  const userNames = users.map(u => u.name);
  const configPatrollers = config.patrollers || [];

  // Combine and deduplicate
  const allPatrollers = [...new Set([...userNames, ...configPatrollers])];

  // Sort alphabetically
  return allPatrollers.sort((a, b) => a.localeCompare(b));
}

export { isSuperuser };
