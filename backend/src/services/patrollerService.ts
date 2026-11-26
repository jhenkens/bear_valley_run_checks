import { getPrismaClient } from '../config/database';
import { appConfig } from '../config/config';
import { isSuperuser } from './superuserService';

export async function getAllPatrollers(): Promise<string[]> {
  const prisma = getPrismaClient();
  const users = await prisma.user.findMany({
    where: { isDispatch: false },
    select: { name: true },
  });

  const userNames = users.map((u: { name: string }) => u.name);
  const configPatrollers = appConfig.patrollers || [];

  // Combine and deduplicate
  const allPatrollers = [...new Set([...userNames, ...configPatrollers])];

  // Sort alphabetically
  return allPatrollers.sort((a, b) => a.localeCompare(b));
}

// Names (lowercased) that belong only to dispatch accounts, so can't be recorded as a patroller
export async function getDispatchOnlyNames(): Promise<Set<string>> {
  const prisma = getPrismaClient();
  const dispatch = await prisma.user.findMany({
    where: { isDispatch: true },
    select: { name: true },
  });
  const patrollers = new Set((await getAllPatrollers()).map(name => name.trim().toLowerCase()));

  return new Set(
    dispatch.map(u => u.name.trim().toLowerCase()).filter(name => !patrollers.has(name))
  );
}

export { isSuperuser };
