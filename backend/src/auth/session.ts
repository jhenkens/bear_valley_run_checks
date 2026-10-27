import fs from 'fs';
import session from 'express-session';
import createSqliteStore from 'connect-sqlite3';
import { appConfig } from '../config/config';

const SQLiteStore = createSqliteStore(session);

let sessionMiddleware: ReturnType<typeof session> | null = null;

// One shared instance, so Express and Socket.IO read the same session store
export function createSessionMiddleware() {
  if (sessionMiddleware) return sessionMiddleware;
  // The sqlite store won't create its directory, and fails with SQLITE_CANTOPEN if it's missing
  fs.mkdirSync('./data', { recursive: true });
  const isProduction = process.env.NODE_ENV === 'production';
  const isHttps = process.env.HTTPS === 'true' || (isProduction && !process.env.HTTPS);
  
  sessionMiddleware = session({
    name: 'bvsp.runcheck.session',
    store: new SQLiteStore({
      db: 'sessions.db',
      dir: './data',
    }) as any,
    secret: appConfig.sessionSecret,
    resave: false,
    saveUninitialized: false,
    proxy: isProduction, // Trust proxy in production for secure cookies
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      httpOnly: true,
      secure: isHttps, // Secure if HTTPS or production (assume HTTPS in prod)
      sameSite: 'lax', // Use lax for better compatibility
      path: '/',
    },
  });
  return sessionMiddleware;
}
