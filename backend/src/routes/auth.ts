import crypto from 'crypto';
import { Router, Response } from 'express';
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

// POST /auth/login - Request magic link
router.post('/login', async (req, res) => {
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

    // Generate magic link
    const token = await generateMagicLink(email.toLowerCase());
    
    // Send magic link email unless disabled
    if (!appConfig.disableMagicLink) {
      try {
        await sendMagicLink(email.toLowerCase(), token);
        res.json({ message: 'Magic link sent to your email' });
      } catch (emailError) {
        logger.error('Failed to send magic link email:', emailError);
        res.status(500).json({ error: 'Failed to send email. Please contact an administrator.' });
      }
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

// GET /auth/verify - Verify magic link token
router.get('/verify', async (req, res) => {
  try {
    const { token } = req.query;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Token is required' });
    }

    const email = await validateToken(token);

    if (!email) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const prisma = getPrismaClient();
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Regenerate session for security
    req.session.regenerate((err) => {
      if (err) {
        logger.error('Session regeneration error:', err);
        return res.status(500).json({ error: 'Failed to create session' });
      }

      // Set session user ID
      req.session.userId = user.id;
      logger.info(`User ${user.email} authenticated via magic link`);

      // Explicitly save session before redirect
      req.session.save((saveErr) => {
        if (saveErr) {
          logger.error('Session save error:', saveErr);
          return res.status(500).json({ error: 'Failed to save session' });
        }
        
        logger.info(`Session saved for user ${user.email}, redirecting to /`);
        // Redirect to main app after session is saved
        res.redirect('/');
      });
    });
  } catch (error) {
    logger.error('Verify error:', error);
    res.status(500).json({ error: 'Internal server error' });
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
    if (!email || info.email_verified === false) {
      return loginError(res, 'Your account has no verified email address');
    }

    const prisma = getPrismaClient();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      logger.warn(`OIDC login for unknown user ${email}`);
      return loginError(res, `No run checks account for ${email}. Ask an administrator to add you.`);
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

// GET /auth/logout - Logout
router.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to logout' });
    }
    res.json({ message: 'Logged out successfully' });
  });
});

// GET /auth/me - Get current user
router.get('/me', requireAuth, async (req: AuthRequest, res) => {
  res.json({ user: req.user });
});

export default router;
