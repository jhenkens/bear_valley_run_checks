import { IRunProvider } from './runProvider';
import { ConfigRunProvider } from './configRunProvider';
import { SheetsRunProvider } from './sheetsRunProvider';
import { appConfig } from '../config/config';

// Singleton instance
let runProviderInstance: IRunProvider | null = null;

export function createRunProvider(): IRunProvider {
  if (runProviderInstance) {
    return runProviderInstance;
  }

  switch (appConfig.runProvider) {
    case 'config':
      runProviderInstance = new ConfigRunProvider();
      break;
    case 'sheets':
      runProviderInstance = new SheetsRunProvider();
      break;
    default:
      throw new Error(`Unknown run provider: ${appConfig.runProvider}`);
  }

  return runProviderInstance;
}

export * from './runProvider';
export * from './configRunProvider';
export * from './sheetsRunProvider';
