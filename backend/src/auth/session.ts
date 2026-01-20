import session from 'express-session';
import createSqliteStore from 'connect-sqlite3';
import { config } from '../config/config';

const SQLiteStore = createSqliteStore(session);

export function createSessionMiddleware() {
  return session({
    store: new SQLiteStore({
      db: 'sessions.db',
      dir: './data',
    }) as any,
    secret: config.env.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    },
  });
}
