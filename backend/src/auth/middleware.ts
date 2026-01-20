import { Request, Response, NextFunction } from 'express';
import { getPrismaClient } from '../config/database';
import { isSuperuser } from '../services/superuserService';

declare module 'express-session' {
  interface SessionData {
    userId: string;
  }
}

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
    isAdmin: boolean;
    isSuperuser: boolean;
  };
}

export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.session.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const prisma = getPrismaClient();
  const user = await prisma.user.findUnique({
    where: { id: req.session.userId },
  });

  if (!user) {
    res.status(401).json({ error: 'User not found' });
    return;
  }

  const userIsSuperuser = isSuperuser(user.email);

  req.user = {
    id: user.id,
    email: user.email,
    name: user.name,
    isAdmin: user.isAdmin || userIsSuperuser,
    isSuperuser: userIsSuperuser,
  };

  next();
}

export async function requireAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  await requireAuth(req, res, () => {
    if (!req.user?.isAdmin) {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }
    next();
  });
}
