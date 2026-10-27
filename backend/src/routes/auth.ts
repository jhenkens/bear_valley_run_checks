import crypto from 'crypto';
import { Router, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { getPrismaClient } from '../config/database';
import { generateMagicLink, validateToken } from '../auth/magicLink';
import { sendMagicLink } from '../services/email';
import { requireAuth, AuthRequest } from '../auth/middleware';
import { appConfig } from '../config/config';
import { logger } from '../utils/logger';
import {
  isOidcEnabled,
  buildAuthorizationRequest,
  exchangeCodeForUserInfo,
} from '../services/oidc';

const router = Router();

// POST /auth/dev-login - DEV ONLY: Direct login without magic link
if (appConfig.enableLoginWithoutPassword) {
  router.post('/dev-login', async (req, res) => {
    try {
      const { email } = req.body;

      if (!email || typeof email !== 'string') {
        return res.status(400).json({ error: 'Email is required' });
      }

      const prisma = getPrismaClient();
      const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Create session directly without magic link
      req.session.userId = user.id;
      req.session.save((err) => {
        if (err) {
          logger.error('Session save error:', err);
          return res.status(500).json({ error: 'Failed to create session' });
        }

        res.json({
          message: 'Logged in successfully (DEV MODE)',
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
          }
        });
      });
    } catch (error) {
      logger.error('Dev login error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
}

// Limit magic link requests per IP and per email address (email bombing / enumeration)
const loginLimiterOptions = { windowMs: 15 * 60 * 1000, standardHeaders: true, legacyHeaders: false } as const;
const loginIpLimiter = rateLimit({ ...loginLimiterOptions, limit: 20 });
const loginEmailLimiter = rateLimit({
  ...loginLimiterOptions,
  limit: 5,
  keyGenerator: (req) => String(req.body?.email || '').toLowerCase() || 'none',
  validate: { keyGeneratorIpFallback: false },
});

// Same answer whether or not the address has an account, so this can't be used to find members
const MAGIC_LINK_SENT = { message: 'If that email has an account, a login link is on its way' };

// POST /auth/login - Request magic link
router.post('/login', loginIpLimiter, loginEmailLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email is required' });
    }

    const prisma = getPrismaClient();
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    // Unknown address, or an account that signs in with single sign-on: say nothing different
    if (!user || user.oidcOnly) {
      return res.json(MAGIC_LINK_SENT);
    }

    // Generate magic link
    const token = await generateMagicLink(email.toLowerCase());

    // Send magic link email unless disabled
    if (!appConfig.disableMagicLink) {
      try {
        await sendMagicLink(email.toLowerCase(), token);
      } catch (emailError) {
        logger.error('Failed to send magic link email:', emailError);
      }
      res.json(MAGIC_LINK_SENT);
    } else {
      // In dev mode with email disabled, return the token directly
      res.json({
        message: 'Magic link generated (email disabled in dev mode)',
        token,
        loginUrl: `${appConfig.appUrl}/auth/verify?token=${token}`
      });
    }
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

// GET /auth/verify - Landing page for the emailed link. It deliberately does NOT consume the
// token: mail scanners and link previews fetch GET links automatically and would burn it.
// The person has to press the button, which POSTs the token back.
router.get('/verify', (req, res) => {
  const { token } = req.query;
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) {
    return loginError(res, 'That login link is invalid');
  }
  res.set('Cache-Control', 'no-store');
  res.type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Log in - Bear Valley Run Checks</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;background:#f5f5f5;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.card{background:#fff;padding:2rem;border-radius:8px;max-width:340px;width:calc(100% - 2rem);text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.15)}
button{background:#3498db;color:#fff;border:0;border-radius:4px;padding:.9rem 1rem;font-size:1.1rem;width:100%;margin-top:1rem}</style></head>
<body><form class="card" method="POST" action="/auth/verify">
<h2>Bear Valley Run Checks</h2><p>Tap below to finish logging in.</p>
<input type="hidden" name="token" value="${token}">
<button type="submit">Log in</button></form></body></html>`);
});

// POST /auth/verify - Verify magic link token and start a session
router.post('/verify', loginIpLimiter, async (req, res) => {
  try {
    const { token } = req.body;

    if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) {
      return loginError(res, 'That login link is invalid');
    }

    const email = await validateToken(token);

    if (!email) {
      return loginError(res, 'That login link is invalid or has expired');
    }

    const prisma = getPrismaClient();
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user || user.oidcOnly) {
      return loginError(res, 'That login link is invalid or has expired');
    }

    // Regenerate session for security
    req.session.regenerate((err) => {
      if (err) {
        logger.error('Session regeneration error:', err);
        return loginError(res, 'Failed to create session');
      }

      // Set session user ID
      req.session.userId = user.id;
      logger.info(`User ${user.email} authenticated via magic link`);

      // Explicitly save session before redirect
      req.session.save((saveErr) => {
        if (saveErr) {
          logger.error('Session save error:', saveErr);
          return loginError(res, 'Failed to save session');
        }

        // The flag lets the frontend offer to save a passkey after a magic link login
        res.redirect('/?login=magic');
      });
    });
  } catch (error) {
    logger.error('Verify error:', error);
    loginError(res, 'Sign-in failed, please try again');
  }
});

// GET /auth/providers - Which login options the frontend should offer
router.get('/providers', (_req, res) => {
  res.json({
    oidc: isOidcEnabled() ? { name: appConfig.oidc.displayName || 'Single Sign-On' } : null,
  });
});

// Send the browser back to the login page with a message the frontend shows.
function loginError(res: Response, message: string) {
  res.redirect(`/?login_error=${encodeURIComponent(message)}`);
}

// GET /auth/oidc/login - Start the OIDC (Authentik) login
router.get('/oidc/login', async (req, res) => {
  if (!isOidcEnabled()) {
    return res.status(404).json({ error: 'OIDC login is not configured' });
  }
  try {
    const { url, state, codeVerifier } = await buildAuthorizationRequest();
    req.session.oidc = { state, codeVerifier };
    req.session.save((err) => {
      if (err) {
        logger.error('Session save error:', err);
        return loginError(res, 'Failed to start sign-in');
      }
      res.redirect(url);
    });
  } catch (error) {
    logger.error('OIDC login start error:', error);
    loginError(res, 'Single sign-on is unavailable right now');
  }
});

// GET /auth/oidc/callback - Finish the OIDC login and create a session
router.get('/oidc/callback', async (req, res) => {
  if (!isOidcEnabled()) {
    return res.status(404).json({ error: 'OIDC login is not configured' });
  }
  const pending = req.session.oidc;
  const { code, state, error: idpError } = req.query;

  try {
    if (idpError) {
      logger.warn(`OIDC provider returned error: ${idpError}`);
      return loginError(res, 'Sign-in was cancelled or denied');
    }
    if (
      !pending ||
      typeof code !== 'string' ||
      typeof state !== 'string' ||
      state.length !== pending.state.length ||
      !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(pending.state))
    ) {
      return loginError(res, 'Sign-in session expired, please try again');
    }

    const info = await exchangeCodeForUserInfo(code, pending.codeVerifier);
    const email = info.email?.toLowerCase();
    if (!email) {
      logger.warn(`OIDC userinfo had no email claim (claims: ${Object.keys(info).join(', ')})`);
      return loginError(res, 'Your account has no email address');
    }
    if (appConfig.oidc.requireVerifiedEmail && info.email_verified !== true) {
      logger.warn(`OIDC email for ${email} is not verified (email_verified=${info.email_verified})`);
      return loginError(res, 'Your email address is not verified');
    }

    const prisma = getPrismaClient();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      logger.warn(`OIDC login for unknown user ${email}`);
      return loginError(res, `No run checks account for ${email}. Ask an administrator to add you.`);
    }

    // First OIDC login migrates the account to OIDC only: no magic links, no passkeys
    if (!user.oidcOnly) {
      await prisma.$transaction([
        prisma.user.update({ where: { id: user.id }, data: { oidcOnly: true } }),
        prisma.authenticator.deleteMany({ where: { userId: user.id } }),
        prisma.magicLink.deleteMany({ where: { OR: [{ userId: user.id }, { email }] } }),
      ]);
      logger.info(`User ${user.email} migrated to OIDC-only`);
    }

    // Regenerate session for security (also drops the pending OIDC state)
    req.session.regenerate((err) => {
      if (err) {
        logger.error('Session regeneration error:', err);
        return loginError(res, 'Failed to create session');
      }
      req.session.userId = user.id;
      req.session.save((saveErr) => {
        if (saveErr) {
          logger.error('Session save error:', saveErr);
          return loginError(res, 'Failed to create session');
        }
        logger.info(`User ${user.email} authenticated via OIDC`);
        res.redirect('/');
      });
    });
  } catch (error) {
    logger.error('OIDC callback error:', error);
    loginError(res, 'Sign-in failed, please try again');
  }
});

// POST /auth/logout - Logout (POST so another site can't log people out with a link or image)
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to logout' });
    }
    res.json({ message: 'Logged out successfully' });
  });
});

// GET /auth/me - Get current user
router.get('/me', requireAuth, async (req: AuthRequest, res) => {
  res.json({ user: req.user, features: { board: appConfig.board.enabled } });
});

export default router;
