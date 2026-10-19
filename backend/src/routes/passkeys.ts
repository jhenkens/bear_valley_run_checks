import crypto from 'crypto';
import { Router } from 'express';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import { getPrismaClient } from '../config/database';
import { requireAuth, AuthRequest } from '../auth/middleware';
import {
  getRelyingPartyConfig,
  userIdToUint8Array,
  transportsToString,
  transportsFromString,
} from '../auth/webauthn';
import aaguids from '../data/aaguids.json';
import { logger } from '../utils/logger';

const router = Router();

const RENAME_WINDOW_MS = 10 * 60 * 1000;

// Passkey provider names (1Password, iCloud Keychain, ...) keyed by AAGUID.
// Browsers may zero the AAGUID under 'none' attestation, so this can miss.
const AAGUID_NAMES = aaguids as Record<string, string>;

function cleanName(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 100) : null;
}

// GET /auth/passkey - List the current user's passkeys
router.get('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    const prisma = getPrismaClient();
    const authenticators = await prisma.authenticator.findMany({
      where: { userId: req.user!.id },
      select: { id: true, name: true, createdAt: true, lastUsedAt: true, deviceType: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ passkeys: authenticators });
  } catch (error) {
    logger.error('Error listing passkeys:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /auth/passkey/:id - Rename a passkey, only right after creating it.
// Needs the one-time rename token that /register/verify handed to this session.
router.patch('/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const name = cleanName(req.body.name);
    const token = req.body.token;
    if (!name || typeof token !== 'string') {
      return res.status(400).json({ error: 'Name and rename token are required' });
    }

    const pending = req.session.passkeyRename;
    const valid =
      pending &&
      pending.id === req.params.id &&
      pending.expiresAt > Date.now() &&
      pending.token.length === token.length &&
      crypto.timingSafeEqual(Buffer.from(pending.token), Buffer.from(token));
    if (!valid) {
      return res.status(403).json({ error: 'Rename is no longer available for this passkey' });
    }

    const prisma = getPrismaClient();
    const authenticator = await prisma.authenticator.findUnique({ where: { id: req.params.id } });
    if (!authenticator || authenticator.userId !== req.user!.id) {
      return res.status(404).json({ error: 'Passkey not found' });
    }

    await prisma.authenticator.update({ where: { id: req.params.id }, data: { name } });
    delete req.session.passkeyRename; // single use
    req.session.save((err) => {
      if (err) {
        logger.error('Failed to clear passkey rename token:', err);
      }
      res.json({ name });
    });
  } catch (error) {
    logger.error('Error renaming passkey:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /auth/passkey/:id - Remove one of the current user's passkeys
router.delete('/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const prisma = getPrismaClient();
    const authenticator = await prisma.authenticator.findUnique({ where: { id: req.params.id } });

    if (!authenticator || authenticator.userId !== req.user!.id) {
      return res.status(404).json({ error: 'Passkey not found' });
    }

    await prisma.authenticator.delete({ where: { id: req.params.id } });
    logger.info('Passkey deleted', { userId: req.user!.id, authenticatorId: req.params.id });
    res.json({ message: 'Passkey removed' });
  } catch (error) {
    logger.error('Error deleting passkey:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /auth/passkey/register/options - Start registering a new passkey (must already be logged in)
router.get('/register/options', requireAuth, async (req: AuthRequest, res) => {
  if (req.user!.oidcOnly) {
    return res.status(403).json({ error: 'Passkeys are not available for single sign-on accounts' });
  }
  try {
    const prisma = getPrismaClient();
    const { rpID, rpName } = getRelyingPartyConfig();

    const existing = await prisma.authenticator.findMany({ where: { userId: req.user!.id } });

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: userIdToUint8Array(req.user!.id),
      userName: req.user!.email || req.user!.name,
      userDisplayName: req.user!.name,
      attestationType: 'none',
      excludeCredentials: existing.map((a) => ({
        id: a.credentialId,
        transports: transportsFromString(a.transports) as any,
      })),
      authenticatorSelection: {
        // Required (not just preferred) so the credential is discoverable -
        // that's what lets login happen without typing a username.
        residentKey: 'required',
        userVerification: 'preferred',
      },
    });

    req.session.currentChallenge = options.challenge;
    req.session.save((err) => {
      if (err) {
        logger.error('Failed to persist passkey registration challenge:', err);
        return res.status(500).json({ error: 'Failed to start passkey registration' });
      }
      res.json(options);
    });
  } catch (error) {
    logger.error('Error generating passkey registration options:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /auth/passkey/register/verify - Finish registering a new passkey
router.post('/register/verify', requireAuth, async (req: AuthRequest, res) => {
  if (req.user!.oidcOnly) {
    return res.status(403).json({ error: 'Passkeys are not available for single sign-on accounts' });
  }
  try {
    const expectedChallenge = req.session.currentChallenge;
    if (!expectedChallenge) {
      return res.status(400).json({ error: 'No pending passkey registration - please try again' });
    }

    const { rpID, origin } = getRelyingPartyConfig();
    const response = req.body.response as RegistrationResponseJSON;
    const fallbackName = cleanName(req.body.name) || 'Passkey';

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      // Options ask for 'preferred'; the library default would reject providers that skip UV
      requireUserVerification: false,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'Passkey registration could not be verified' });
    }

    const { credential, credentialDeviceType, credentialBackedUp, aaguid } = verification.registrationInfo;
    const name = AAGUID_NAMES[aaguid.toLowerCase()] || fallbackName;

    const prisma = getPrismaClient();
    const created = await prisma.authenticator.create({
      data: {
        userId: req.user!.id,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        transports: transportsToString(credential.transports),
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        name,
      },
    });

    delete req.session.currentChallenge;
    const renameToken = crypto.randomBytes(24).toString('hex');
    req.session.passkeyRename = { id: created.id, token: renameToken, expiresAt: Date.now() + RENAME_WINDOW_MS };

    logger.info('Passkey registered', { userId: req.user!.id, name, aaguid });
    req.session.save((saveErr) => {
      if (saveErr) {
        logger.error('Failed to persist passkey rename token:', saveErr);
      }
      res.json({ verified: true, id: created.id, name, renameToken });
    });
  } catch (error) {
    logger.error('Error verifying passkey registration:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /auth/passkey/authenticate/options - Start a passkey login (no user known yet)
router.get('/authenticate/options', async (req, res) => {
  try {
    const { rpID } = getRelyingPartyConfig();

    // No allowCredentials - this is what makes the credential list
    // "discoverable": the browser/OS shows every passkey registered for this
    // site rather than one we've pre-selected, so login needs no username.
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'preferred',
    });

    req.session.currentChallenge = options.challenge;
    req.session.save((err) => {
      if (err) {
        logger.error('Failed to persist passkey authentication challenge:', err);
        return res.status(500).json({ error: 'Failed to start passkey login' });
      }
      res.json(options);
    });
  } catch (error) {
    logger.error('Error generating passkey authentication options:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /auth/passkey/authenticate/verify - Finish a passkey login
router.post('/authenticate/verify', async (req, res) => {
  try {
    const expectedChallenge = req.session.currentChallenge;
    if (!expectedChallenge) {
      return res.status(400).json({ error: 'No pending passkey login - please try again' });
    }

    const response = req.body.response as AuthenticationResponseJSON;
    const prisma = getPrismaClient();

    const authenticator = await prisma.authenticator.findUnique({
      where: { credentialId: response.id },
      include: { user: true },
    });

    if (!authenticator || authenticator.user.oidcOnly) {
      return res.status(401).json({ error: 'Passkey not recognized' });
    }

    const { rpID, origin } = getRelyingPartyConfig();

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
      credential: {
        id: authenticator.credentialId,
        publicKey: new Uint8Array(authenticator.publicKey),
        counter: authenticator.counter,
        transports: transportsFromString(authenticator.transports) as any,
      },
    });

    if (!verification.verified) {
      return res.status(401).json({ error: 'Passkey login could not be verified' });
    }

    await prisma.authenticator.update({
      where: { id: authenticator.id },
      data: {
        counter: verification.authenticationInfo.newCounter,
        lastUsedAt: new Date(),
      },
    });

    delete req.session.currentChallenge;

    // Regenerate session for security, same as magic link login
    req.session.regenerate((err) => {
      if (err) {
        logger.error('Session regeneration error during passkey login:', err);
        return res.status(500).json({ error: 'Failed to create session' });
      }

      req.session.userId = authenticator.user.id;
      logger.info(`User ${authenticator.user.email} authenticated via passkey`);

      req.session.save((saveErr) => {
        if (saveErr) {
          logger.error('Session save error during passkey login:', saveErr);
          return res.status(500).json({ error: 'Failed to save session' });
        }

        res.json({
          user: {
            id: authenticator.user.id,
            email: authenticator.user.email,
            name: authenticator.user.name,
          },
        });
      });
    });
  } catch (error) {
    logger.error('Error verifying passkey authentication:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
