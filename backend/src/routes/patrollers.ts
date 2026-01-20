import { Router } from 'express';
import { getAllPatrollers } from '../services/patrollerService';
import { requireAuth } from '../auth/middleware';

const router = Router();

// GET /api/patrollers - Get all patroller names
router.get('/patrollers', requireAuth, async (req, res) => {
  try {
    const patrollers = await getAllPatrollers();
    res.json({ patrollers });
  } catch (error) {
    console.error('Error fetching patrollers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
