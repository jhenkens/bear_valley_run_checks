// Local testing only: replaces the Patrol Board contents with sample items relative to today.
//   npm run seed:board            reset the board to sample data
//   npm run seed:board -- --sweep also run the archive sweep right away (needs no Google in dev)
import { getPrismaClient, disconnectDatabase } from '../config/database';
import { getTodaySheetName, addDaysToDateString } from '../services/googleSheets';
import { archiveInactive } from '../services/boardService';

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed the board in production');
  }

  const prisma = getPrismaClient();
  const today = getTodaySheetName();
  const tomorrow = addDaysToDateString(today, 1);
  const yesterday = addDaysToDateString(today, -1);
  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60 * 1000);

  await prisma.boardItem.deleteMany();

  const items = [
    // Debrief notes captured on the hill today
    { description: 'Rope line down at the top of Grizzly (Upper), two stanchions missing', section: 'Grizzly', authorName: 'John Doe', debriefDate: today, createdAt: minutesAgo(300) },
    { description: 'Guest reported a loose binding on a rental at Valley Express base', section: 'Valley Express', authorName: 'Jane Smith', debriefDate: today, createdAt: minutesAgo(180) },
    { description: 'Sled #3 has a flat tire', authorName: 'Mike Wilson', debriefDate: today, createdAt: minutesAgo(60) },
    // Already queued for this morning's brief
    { description: 'Avalanche control on Expansion at 8:00, hold the lift', section: 'Expansion', authorName: 'Sarah Johnson', morningBriefDate: today, createdAt: minutesAgo(900) },
    // Queued for tomorrow's brief (also in today's debrief)
    { description: 'Kodiak cat track needs a sign before the weekend', section: 'Kodiak', authorName: 'John Doe', debriefDate: today, morningBriefDate: tomorrow, createdAt: minutesAgo(240) },
    // Tasks
    { description: 'Restock the first aid cabinet at the top shack', authorName: 'Jane Smith', isTask: true, dueDate: today, dueHour: 12, createdAt: minutesAgo(1000) },
    { description: 'Replace worn rope on Pooh Bear (Lower)', section: 'Pooh Bear', authorName: 'Mike Wilson', isTask: true, dueDate: yesterday, assignee: 'Sarah Johnson', createdAt: minutesAgo(3000) },
    { description: 'Re-paint the Apache closure sign', section: 'Expansion', authorName: 'John Doe', isTask: true, dueDate: addDaysToDateString(today, 3), createdAt: minutesAgo(2000) },
    { description: 'Check radio batteries', authorName: 'Jane Smith', isTask: true, dueDate: today, assignee: 'John Doe', doneAt: minutesAgo(30), doneBy: 'John Doe', createdAt: minutesAgo(1200) },
    // Yesterday's note: nothing keeps it on the board, so the next sweep archives it
    { description: "Yesterday's debrief note (archived by the sweep)", authorName: 'John Doe', debriefDate: yesterday, createdAt: minutesAgo(1500) },
  ];
  for (const item of items) {
    await prisma.boardItem.create({ data: item });
  }
  console.log(`Seeded ${items.length} board items for ${today}`);

  if (process.argv.includes('--sweep')) {
    await archiveInactive();
    const archived = await prisma.boardItem.count({ where: { archivedAt: { not: null } } });
    console.log(`Archive sweep done: ${archived} item(s) archived`);
  }
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => disconnectDatabase());
