import crypto from 'crypto';
import { appConfig } from '../config/config';

// AES-256-GCM for secrets stored in the database (Google OAuth tokens). The key comes from
// TOKEN_ENCRYPTION_KEY, falling back to SESSION_SECRET. Rotating it makes stored tokens
// unreadable, so the admin would need to re-link Google.
const PREFIX = 'enc:v1:';

const key = crypto
  .createHash('sha256')
  .update(`token-encryption:${process.env.TOKEN_ENCRYPTION_KEY || appConfig.sessionSecret}`)
  .digest();

export function encryptSecret(plain: string): string {
  if (plain.startsWith(PREFIX)) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${PREFIX}${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${data.toString('base64')}`;
}

// Values without the prefix are legacy plaintext; they're re-encrypted on the next write
export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const [iv, tag, data] = stored.slice(PREFIX.length).split(':').map((p) => Buffer.from(p, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
