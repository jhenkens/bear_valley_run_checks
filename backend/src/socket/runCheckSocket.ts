import { Server as SocketIOServer } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { createSessionMiddleware } from '../auth/session';
import { logger } from '../utils/logger';

export function setupSocket(server: HTTPServer): SocketIOServer {
  const io = new SocketIOServer(server, {
    cors: {
      origin: process.env.NODE_ENV === 'production'
        ? false
        : ['http://localhost:8080', 'http://localhost:3000'],
      credentials: true,
    },
  });

  // Only logged-in users may connect: run to read the session cookie, then check it
  const sessionMiddleware = createSessionMiddleware();
  io.engine.use(sessionMiddleware);
  io.use((socket, next) => {
    const session = (socket.request as any).session;
    if (session?.userId) return next();
    next(new Error('Authentication required'));
  });

  io.on('connection', (socket) => {
    logger.info('Client connected', { socketId: socket.id });

    socket.on('disconnect', () => {
      logger.info('Client disconnected', { socketId: socket.id });
    });
  });

  return io;
}
