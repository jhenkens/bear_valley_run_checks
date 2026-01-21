import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function connectSocket(onRunCheckNew: (data: any) => void, onReconnect?: () => void): Socket {
  if (socket) {
    return socket;
  }

  socket = io({
    transports: ['websocket', 'polling'],
  });

  socket.on('connect', () => {
    // Socket connected
    console.log('Socket connected');
  });

  socket.on('disconnect', () => {
    // Socket disconnected
    console.log('Socket disconnected');
  });

  // On reconnect after disconnect, refresh data
  socket.io.on('reconnect', () => {
    console.log('Socket reconnected');
    if (onReconnect) {
      onReconnect();
    }
  });

  socket.on('runcheck:new', (data) => {
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
