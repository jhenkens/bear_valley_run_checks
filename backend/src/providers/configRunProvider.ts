import { IRunProvider } from './runProvider';
import { Run, appConfig } from '../config/config';
import { logger } from '../utils/logger';

export class ConfigRunProvider implements IRunProvider {
  private runs: Run[];
  private initialized: boolean = false;

  constructor() {
    this.runs = appConfig.runs;
  }

  async initialize(): Promise<void> {
    if(this.initialized) {
      return;
    }
    logger.info(`ConfigRunProvider initialized with ${this.runs.length} runs`);
    this.initialized = true;
  }

  getRuns(): Run[] {
    return this.runs;
  }
}
