import { Router } from 'express';
import { createRunProvider } from '../providers';
import { getChecks, addCheck } from '../services/runCheckCache';
import { requireAuth, AuthRequest } from '../auth/middleware';
import { appConfig } from '../config/config';
import { logger } from '../utils/logger';

const router = Router();
const runProvider = createRunProvider();

// GET /api/runs - Get all runs
router.get('/runs', requireAuth, async (req, res) => {
  try {
    const runs = runProvider.getRuns();
    res.json({ runs, timezone: appConfig.timezone });
  } catch (error) {
    logger.error('Error fetching runs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/runchecks/today - Get today's run checks
router.get('/runchecks/today', requireAuth, async (req, res) => {
  try {
    const checks = getChecks();
    // Convert dates to epoch seconds for API
    const checksWithEpoch = checks.map(check => ({
      ...check,
      checkTime: Math.floor(check.checkTime.getTime() / 1000),
      createdAt: Math.floor(check.createdAt.getTime() / 1000),
    }));
    res.json({ checks: checksWithEpoch });
  } catch (error) {
    logger.error('Error fetching run checks:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/runchecks - Submit new run checks
router.post('/runchecks', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { checks } = req.body;

    if (!Array.isArray(checks) || checks.length === 0) {
      return res.status(400).json({ error: 'Checks array is required' });
    }

    const now = new Date();
    const maxFutureTime = new Date(now.getTime() + 15 * 60 * 1000); // +15 minutes

    const savedChecks = [];

    for (const check of checks) {
      const { runName, section, patroller, checkTime } = check;

      if (!runName || !section || !patroller || checkTime === undefined) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // Convert epoch seconds to Date
      const checkTimeDate = new Date(checkTime * 1000);

      // Validate check time (now to +15 min)
      if (checkTimeDate > maxFutureTime) {
        return res.status(400).json({
          error: 'Check time cannot be more than 15 minutes in the future'
        });
      }

      if (checkTimeDate < new Date(now.getTime() - 24 * 60 * 60 * 1000)) {
        return res.status(400).json({
          error: 'Check time cannot be more than 24 hours in the past'
        });
      }

      const savedCheck = await addCheck({
        runName,
        section,
        patroller,
        checkTime: checkTimeDate,
      });

      savedChecks.push(savedCheck);
    }

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      // Convert to epoch seconds for socket emission
      const checksWithEpoch = savedChecks.map(check => ({
        ...check,
        checkTime: Math.floor(check.checkTime.getTime() / 1000),
        createdAt: Math.floor(check.createdAt.getTime() / 1000),
      }));
      io.emit('runcheck:new', { checks: checksWithEpoch });
    }

    // Convert to epoch seconds for response
    const checksWithEpoch = savedChecks.map(check => ({
      ...check,
      checkTime: Math.floor(check.checkTime.getTime() / 1000),
      createdAt: Math.floor(check.createdAt.getTime() / 1000),
    }));

    res.json({ checks: checksWithEpoch });
  } catch (error) {
    logger.error('Error submitting run checks:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
