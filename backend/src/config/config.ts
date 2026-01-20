import config from 'config';

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
  timezone: string;
  databaseUrl: string;
  sessionSecret: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  emailFrom: string;
  appUrl: string;
  port: number;
}

function loadConfig(): AppConfig {
  // Transform runs from sections to flat array
  const runSections = config.get<RunSection[]>('runs');
  const runs: Run[] = [];

  for (const section of runSections) {
    for (const runName of section.runs) {
      runs.push({
        name: runName,
        section: section.section,
      });
    }
  }

  return {
    runProvider: config.get<'config' | 'sheets'>('runProvider'),
    runs,
    superusers: config.get<Superuser[]>('superusers'),
    patrollers: config.get<string[]>('patrollers'),
    enableLoginWithoutPassword: config.get<boolean>('enableLoginWithoutPassword'),
    disableMagicLink: config.get<boolean>('disableMagicLink'),
    timezone: config.get<string>('timezone'),
    databaseUrl: config.get<string>('databaseUrl'),
    sessionSecret: config.get<string>('sessionSecret'),
    smtpHost: config.get<string>('smtpHost'),
    smtpPort: config.get<number>('smtpPort'),
    smtpUser: config.get<string>('smtpUser'),
    smtpPass: config.get<string>('smtpPass'),
    emailFrom: config.get<string>('emailFrom'),
    appUrl: config.get<string>('appUrl'),
    port: config.get<number>('port'),
  };
}

export const appConfig = loadConfig();
