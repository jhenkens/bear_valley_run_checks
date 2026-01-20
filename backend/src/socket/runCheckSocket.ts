import { Server as SocketIOServer } from 'socket.io';
import { Server as HTTPServer } from 'http';

export function setupSocket(server: HTTPServer): SocketIOServer {
  const io = new SocketIOServer(server, {
    cors: {
      origin: process.env.NODE_ENV === 'production'
        ? false
        : ['http://localhost:8080', 'http://localhost:3000'],
      credentials: true,
    },
  });

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });

  return io;
}
