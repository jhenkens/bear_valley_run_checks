import session from 'express-session';
import createSqliteStore from 'connect-sqlite3';
import { appConfig } from '../config/config';

const SQLiteStore = createSqliteStore(session);

export function createSessionMiddleware() {
  const isProduction = process.env.NODE_ENV === 'production';
  const isHttps = process.env.HTTPS === 'true' || (isProduction && !process.env.HTTPS);
  
  return session({
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
}
