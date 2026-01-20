import { IRunProvider } from './runProvider';
import { ConfigRunProvider } from './configRunProvider';
import { SheetsRunProvider } from './sheetsRunProvider';
import { config } from '../config/config';

export function createRunProvider(): IRunProvider {
  switch (config.runProvider) {
    case 'config':
      return new ConfigRunProvider();
    case 'sheets':
      return new SheetsRunProvider();
    default:
      throw new Error(`Unknown run provider: ${config.runProvider}`);
  }
}

export * from './runProvider';
export * from './configRunProvider';
export * from './sheetsRunProvider';
