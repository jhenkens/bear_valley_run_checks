import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import { config } from './config/config';
import { createSessionMiddleware } from './auth/session';
import { setupSocket } from './socket/runCheckSocket';
import { createRunProvider } from './providers';
import { initialize as initializeRunCheckCache } from './services/runCheckCache';
import { initializeGoogleSheets } from './services/googleSheets';

// Import routes
import authRoutes from './routes/auth';
import runcheckRoutes from './routes/runchecks';
import patrollerRoutes from './routes/patrollers';
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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(createSessionMiddleware());

// API Routes
app.use('/auth', authRoutes);
app.use('/api', runcheckRoutes);
app.use('/api', patrollerRoutes);
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
  res.json({ status: 'ok', provider: config.runProvider });
});

// Initialize application
async function startServer() {
  try {
    console.log('Starting Bear Valley Run Checks Backend...');
    console.log(`Run Provider: ${config.runProvider}`);

    // Initialize run provider
    const runProvider = createRunProvider();
    await runProvider.initialize();

    // Initialize Google Sheets if configured
    if (config.runProvider === 'sheets') {
      await initializeGoogleSheets();
    }

    // Initialize run check cache
    await initializeRunCheckCache();

    // Start server
    const port = config.env.port;
    server.listen(port, () => {
      console.log(`Server running on port ${port}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`Superusers: ${config.superusers.join(', ')}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Start the server
startServer();
