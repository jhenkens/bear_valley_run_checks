import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function connectSocket(onRunCheckNew: (data: any) => void): Socket {
  if (socket) {
    return socket;
  }

  socket = io({
    transports: ['websocket', 'polling'],
  });

  socket.on('connect', () => {
    console.log('Socket connected');
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected');
  });

  socket.on('runcheck:new', (data) => {
    console.log('New run check received:', data);
    onRunCheckNew(data);
  });

  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
