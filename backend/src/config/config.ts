import dotenv from 'dotenv';
import config from 'config';

dotenv.config();

export interface Run {
  name: string;
  section: string;
}

export interface RunSection {
  section: string;
  runs: string[];
}

export interface Superuser {
  email: string;
  name: string;
}

export interface AppConfig {
  runProvider: 'config' | 'sheets';
  runs: Run[];
  superusers: Superuser[];
  patrollers: string[];
  enableLoginWithoutPassword: boolean;
  disableMagicLink: boolean;
  env: {
    databaseUrl: string;
    sessionSecret: string;
    smtpHost: string;
    smtpPort: number;
    smtpUser: string;
    smtpPass: string;
    emailFrom: string;
    appUrl: string;
    port: number;
    googleSheetsId?: string;
    googleServiceAccountEmail?: string;
    googlePrivateKey?: string;
  };
}

function loadConfig(): AppConfig {
  // Transform runs from sections to flat array
  const runs: Run[] = [];
  const runSections = config.get<RunSection[]>('runs');
  
  for (const section of runSections) {
    for (const runName of section.runs) {
      runs.push({
        name: runName,
        section: section.section,
      });
    }
  }

  return {
    runProvider: process.env.RUN_PROVIDER as 'config' | 'sheets' || config.get<'config' | 'sheets'>('runProvider'),
    runs,
    superusers: config.get<Superuser[]>('superusers'),
    patrollers: config.get<string[]>('patrollers'),
    enableLoginWithoutPassword: config.get<boolean>('enableLoginWithoutPassword'),
    disableMagicLink: config.get<boolean>('disableMagicLink'),
    env: {
      databaseUrl: process.env.DATABASE_URL || 'file:./dev.db',
      sessionSecret: process.env.SESSION_SECRET || 'change-this-secret',
      smtpHost: process.env.SMTP_HOST || 'localhost',
      smtpPort: parseInt(process.env.SMTP_PORT || '587', 10),
      smtpUser: process.env.SMTP_USER || '',
      smtpPass: process.env.SMTP_PASS || '',
      emailFrom: process.env.EMAIL_FROM || 'noreply@example.com',
      appUrl: process.env.APP_URL || 'http://localhost:3000',
      port: parseInt(process.env.PORT || '3000', 10),
      googleSheetsId: process.env.GOOGLE_SHEETS_ID,
      googleServiceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      googlePrivateKey: process.env.GOOGLE_PRIVATE_KEY,
    },
  };
}

export const appConfig = loadConfig();
