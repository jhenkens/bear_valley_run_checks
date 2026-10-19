import { defineConfig, env } from 'prisma/config';

// Prisma 7 no longer reads the datasource URL from schema.prisma or loads .env itself.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
});
