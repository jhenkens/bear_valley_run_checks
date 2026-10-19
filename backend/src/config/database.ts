import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { encryptSecret, decryptSecret } from '../utils/tokenCrypto';

const TOKEN_FIELDS = ['accessToken', 'refreshToken'] as const;

function encryptTokens(data: any) {
  if (!data) return data;
  for (const field of TOKEN_FIELDS) {
    if (typeof data[field] === 'string') data[field] = encryptSecret(data[field]);
  }
  return data;
}

// Google OAuth tokens are encrypted on write and decrypted on read, so the rest of the app
// (and the Google client) only ever sees plaintext.
function createClient() {
  // Prisma 7 talks to SQLite through a driver adapter rather than its own engine.
  const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? 'file:./dev.db' });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  }).$extends({
    query: {
      googleOAuth: {
        create({ args, query }) {
          encryptTokens(args.data);
          return query(args);
        },
        update({ args, query }) {
          encryptTokens(args.data);
          return query(args);
        },
        updateMany({ args, query }) {
          encryptTokens(args.data);
          return query(args);
        },
        upsert({ args, query }) {
          encryptTokens(args.create);
          encryptTokens(args.update);
          return query(args);
        },
      },
    },
    result: {
      googleOAuth: {
        accessToken: {
          needs: { accessToken: true },
          compute: (row) => decryptSecret(row.accessToken),
        },
        refreshToken: {
          needs: { refreshToken: true },
          compute: (row) => decryptSecret(row.refreshToken),
        },
      },
    },
  });
}

type ExtendedPrismaClient = ReturnType<typeof createClient>;

let prismaInstance: ExtendedPrismaClient;

export function getPrismaClient(): ExtendedPrismaClient {
  if (!prismaInstance) {
    prismaInstance = createClient();
  }
  return prismaInstance;
}

export const prisma = getPrismaClient();

export async function disconnectDatabase(): Promise<void> {
  if (prismaInstance) {
    await prismaInstance.$disconnect();
  }
}
