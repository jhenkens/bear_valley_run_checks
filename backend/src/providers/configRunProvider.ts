import { IRunProvider } from './runProvider';
import { Run, config } from '../config/config';
import { logger } from '../utils/logger';

export class ConfigRunProvider implements IRunProvider {
  private runs: Run[];

  constructor() {
    this.runs = config.runs;
  }

  async initialize(): Promise<void> {
    logger.info(`ConfigRunProvider initialized with ${this.runs.length} runs`);
  }

  getRuns(): Run[] {
    return this.runs;
  }
}
