import { Router } from 'express';
import { getPrismaClient } from '../config/database';
import { generateMagicLink, validateToken } from '../auth/magicLink';
import { sendMagicLink } from '../services/email';
import { requireAuth, AuthRequest } from '../auth/middleware';
import { config } from '../config/config';

const router = Router();

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

    const token = await generateMagicLink(email.toLowerCase());
    await sendMagicLink(email.toLowerCase(), token);

    res.json({ message: 'Magic link sent to your email' });
  } catch (error) {
    console.error('Login error:', error);
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
    console.error('Verify error:', error);
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
