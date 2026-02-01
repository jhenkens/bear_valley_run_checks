import { Router } from 'express';
import { getPrismaClient } from '../config/database';
import { generateMagicLink } from '../auth/magicLink';
import { sendWelcomeEmail } from '../services/email';
import { requireAdmin, AuthRequest } from '../auth/middleware';
import { isSuperuser } from '../services/patrollerService';
import { appConfig } from '../config/config';
import { logger } from '../utils/logger';

const router = Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

// GET /api/users - List all users
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const prisma = getPrismaClient();
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        isAdmin: true,
        createdAt: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    const usersWithSuperuser = users.map(user => ({
      ...user,
      isSuperuser: user.email ? isSuperuser(user.email) : false,
    }));

    res.json({ users: usersWithSuperuser });
  } catch (error) {
    logger.error('Error fetching users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/users - Create new user
router.post('/users', requireAdmin, async (req, res) => {
  try {
    const { email, name } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const emailLower = email ? email.toLowerCase().trim() : null;

    if (emailLower && !validateEmail(emailLower)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const prisma = getPrismaClient();

    // Check if user already exists by email (only if email provided)
    if (emailLower) {
      const existing = await prisma.user.findUnique({
        where: { email: emailLower },
      });

      if (existing) {
        return res.status(409).json({ error: 'A user with that email already exists' });
      }
    }

    // Create user
    const user = await prisma.user.create({
      data: {
        email: emailLower,
        name,
        isAdmin: false,
      },
    });

    // Generate magic link and optionally send welcome email (only if email provided)
    let message = 'User created';

    if (emailLower) {
      const token = await generateMagicLink(emailLower);

      if (!appConfig.disableMagicLink) {
        try {
          await sendWelcomeEmail(emailLower, token);
          message = 'User created and welcome email sent';
        } catch (emailError) {
          logger.error('Failed to send welcome email:', emailError);
          message = 'User created (email sending failed - please check SMTP configuration)';
        }
      } else {
        message = 'User created (email disabled in dev mode)';
      }
    } else {
      message = 'User created (no email - login not available)';
    }

    res.json({
      user: {
        ...user,
        isSuperuser: false,
      },
      message,
    });
  } catch (error) {
    logger.error('Error creating user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/users/:id - Update user (name and/or email)
router.patch('/users/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email } = req.body;

    const prisma = getPrismaClient();
    const user = await prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Cannot edit superusers
    if (user.email && isSuperuser(user.email)) {
      return res.status(403).json({ error: 'Cannot modify superuser' });
    }

    const data: { name?: string; email?: string | null } = {};

    if (name !== undefined) {
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'Name cannot be empty' });
      }
      data.name = name.trim();
    }

    if (email !== undefined) {
      if (email === '' || email === null) {
        // Allow clearing email
        data.email = null;
      } else {
        const emailLower = email.toLowerCase().trim();
        if (!validateEmail(emailLower)) {
          return res.status(400).json({ error: 'Invalid email format' });
        }
        // Check uniqueness if email changed
        if (emailLower !== user.email) {
          const existing = await prisma.user.findUnique({
            where: { email: emailLower },
          });
          if (existing) {
            return res.status(409).json({ error: 'A user with that email already exists' });
          }
        }
        data.email = emailLower;
      }
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const updated = await prisma.user.update({
      where: { id },
      data,
    });

    res.json({
      user: {
        ...updated,
        isSuperuser: updated.email ? isSuperuser(updated.email) : false,
      },
      message: 'User updated',
    });
  } catch (error) {
    logger.error('Error updating user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/users/:id/admin - Toggle admin status
router.patch('/users/:id/admin', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { isAdmin } = req.body;

    if (typeof isAdmin !== 'boolean') {
      return res.status(400).json({ error: 'isAdmin must be a boolean' });
    }

    const prisma = getPrismaClient();
    const user = await prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Cannot demote superusers
    if (user.email && isSuperuser(user.email)) {
      return res.status(403).json({ error: 'Cannot modify superuser admin status' });
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { isAdmin },
    });

    res.json({
      user: {
        ...updated,
        isSuperuser: false,
      },
    });
  } catch (error) {
    logger.error('Error updating user admin status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/users/:id - Delete user
router.delete('/users/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const prisma = getPrismaClient();
    const user = await prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Cannot delete superusers
    if (user.email && isSuperuser(user.email)) {
      return res.status(403).json({ error: 'Cannot delete superuser' });
    }

    await prisma.user.delete({
      where: { id },
    });

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    logger.error('Error deleting user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
