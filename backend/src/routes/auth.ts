import { Router } from 'express';
import { getPrismaClient } from '../config/database';
import { generateMagicLink, validateToken } from '../auth/magicLink';
import { sendMagicLink } from '../services/email';
import { requireAuth, AuthRequest } from '../auth/middleware';
import { appConfig } from '../config/config';
import { logger } from '../utils/logger';

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

      res.json({
        message: 'Logged in successfully (DEV MODE)',
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        }
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
        loginUrl: `${appConfig.env.appUrl}/auth/verify?token=${token}`
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

    req.session.userId = user.id;

    // Redirect to main app
    res.redirect('/');
  } catch (error) {
    logger.error('Verify error:', error);
    res.status(500).json({ error: 'Internal server error' });
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
