import crypto from 'crypto';
import { getPrismaClient } from '../config/database';

// Only a hash is stored, so a database leak can't be replayed as login links
const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

const MAGIC_LINK_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes

export async function generateMagicLink(email: string): Promise<string> {
  const prisma = getPrismaClient();
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRY_MS);

  await prisma.magicLink.create({
    data: {
      token: hashToken(token),
      email,
      expiresAt,
      used: false,
    },
  });

  return token;
}

export async function validateToken(token: string): Promise<string | null> {
  const prisma = getPrismaClient();

  const magicLink = await prisma.magicLink.findUnique({
    where: { token: hashToken(token) },
  });

  if (!magicLink) {
    return null;
  }

  if (magicLink.used) {
    return null;
  }

  if (magicLink.expiresAt < new Date()) {
    return null;
  }

  // Mark as used
  await prisma.magicLink.update({
    where: { id: magicLink.id },
    data: { used: true },
  });

  return magicLink.email;
}
