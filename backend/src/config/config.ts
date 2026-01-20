import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

dotenv.config();

export interface Run {
  name: string;
  section: string;
}

export interface RunSection {
  section: string;
  runs: string[];
}

export interface AppConfig {
  runProvider: 'config' | 'sheets';
  runs: Run[];
  superusers: string[];
  patrollers: string[];
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
  // Load config.yaml
  const configPath = path.join(__dirname, '../../config.yaml');
  const configFile = fs.readFileSync(configPath, 'utf8');
  const configYaml = yaml.load(configFile) as {
    runProvider: 'config' | 'sheets';
    runs?: RunSection[];
    superusers?: string[];
    patrollers?: string[];
  };

  // Transform runs from sections to flat array
  const runs: Run[] = [];
  if (configYaml.runs) {
    for (const section of configYaml.runs) {
      for (const runName of section.runs) {
        runs.push({
          name: runName,
          section: section.section,
        });
      }
    }
  }

  return {
    runProvider: process.env.RUN_PROVIDER as 'config' | 'sheets' || configYaml.runProvider || 'config',
    runs,
    superusers: configYaml.superusers || [],
    patrollers: configYaml.patrollers || [],
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

export const config = loadConfig();
