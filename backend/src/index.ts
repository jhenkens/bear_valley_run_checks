import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import morgan from 'morgan';
import { appConfig } from './config/config';
import { createSessionMiddleware } from './auth/session';
import { setupSocket } from './socket/runCheckSocket';
import { createRunProvider } from './providers';
import { initialize as initializeRunCheckCache } from './services/runCheckCache';
import { initializeGoogleSheets } from './services/googleSheets';
import { syncSuperusers } from './services/superuserService';
import { logger } from './utils/logger';

// Import routes
import authRoutes from './routes/auth';
import runcheckRoutes from './routes/runchecks';
import userRoutes from './routes/users';

const app = express();
const server = http.createServer(app);
const io = setupSocket(server);

// Make io available to routes
app.set('io', io);

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? false
    : ['http://localhost:8080', 'http://localhost:3000'],
  credentials: true,
}));

// HTTP request logging
// In development, use 'dev' format which is colored and detailed
// In production, use 'combined' format which is Apache-style
const morganFormat = process.env.NODE_ENV === 'production' ? 'combined' : 'dev';
app.use(morgan(morganFormat, {
  stream: {
    write: (message: string) => logger.http(message.trim())
  }
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(createSessionMiddleware());

// API Routes
app.use('/auth', authRoutes);
app.use('/api', runcheckRoutes);
app.use('/api', userRoutes);

// Serve static files from frontend in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../../frontend/dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../../frontend/dist/index.html'));
  });
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', provider: appConfig.runProvider });
});

// Initialize application
async function startServer() {
  try {
    logger.info('Starting Bear Valley Run Checks Backend...');
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`Run Provider: ${appConfig.runProvider}`);

    // Sync superusers from config.yaml to database
    await syncSuperusers();

    // Initialize Google Sheets BEFORE run provider (if using sheets provider)
    // SheetsRunProvider depends on Google Sheets being initialized
    if (appConfig.runProvider === 'sheets' && process.env.NODE_ENV === 'production') {
      await initializeGoogleSheets();
      logger.info('Google Sheets integration enabled');
    } else if (appConfig.runProvider === 'sheets') {
      logger.warn('Google Sheets provider configured but skipped in development mode');
      logger.warn('Run checks will be stored in memory only');
    }

    // Initialize run provider (depends on Google Sheets if using sheets provider)
    const runProvider = createRunProvider();
    await runProvider.initialize();

    // Initialize run check cache
    await initializeRunCheckCache();

    // Start server
    const port = appConfig.port;
    server.listen(port, () => {
      logger.info(`🚀 Server running on port ${port}`);
      logger.info(`📧 Superusers: ${appConfig.superusers.map(su => su.email).join(', ')}`);

      if (appConfig.enableLoginWithoutPassword) {
        logger.info('⚡ DEV: Password-less login enabled at POST /auth/dev-login');
      }
      if (appConfig.disableMagicLink) {
        logger.info('⚡ DEV: Magic link emails disabled');
      }
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

// Start the server
startServer();
