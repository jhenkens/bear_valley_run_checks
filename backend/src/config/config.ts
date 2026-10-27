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

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  displayName: string;
  requireVerifiedEmail: boolean;
}

export interface BoardConfig {
  enabled: boolean;
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
  oidc: OidcConfig;
  board: BoardConfig;
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
    oidc: config.get<OidcConfig>('oidc'),
    board: config.get<BoardConfig>('board'),
  };
}

const DEFAULT_SESSION_SECRETS = ['change-this-secret', 'change-this-to-a-random-secret-in-production'];

// Refuse to boot production with dev settings, rather than silently running insecure.
function assertSafeForProduction(cfg: AppConfig): void {
  if (process.env.NODE_ENV !== 'production') return;
  const problems: string[] = [];
  if (DEFAULT_SESSION_SECRETS.includes(cfg.sessionSecret) || cfg.sessionSecret.length < 32) {
    problems.push('SESSION_SECRET must be set to a random value of at least 32 characters');
  }
  if (cfg.enableLoginWithoutPassword) {
    problems.push('enableLoginWithoutPassword must be false (it allows login without any credential)');
  }
  if (!process.env.APP_URL) {
    problems.push('APP_URL must be set');
  }
  if (problems.length > 0) {
    throw new Error(`Unsafe production configuration:\n - ${problems.join('\n - ')}`);
  }
}

export const appConfig = loadConfig();
assertSafeForProduction(appConfig);
