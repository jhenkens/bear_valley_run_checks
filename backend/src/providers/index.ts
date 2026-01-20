import { IRunProvider } from './runProvider';
import { ConfigRunProvider } from './configRunProvider';
import { SheetsRunProvider } from './sheetsRunProvider';
import { appConfig } from '../config/config';

export function createRunProvider(): IRunProvider {
  switch (appConfig.runProvider) {
    case 'config':
      return new ConfigRunProvider();
    case 'sheets':
      return new SheetsRunProvider();
    default:
      throw new Error(`Unknown run provider: ${appConfig.runProvider}`);
  }
}

export * from './runProvider';
export * from './configRunProvider';
export * from './sheetsRunProvider';
