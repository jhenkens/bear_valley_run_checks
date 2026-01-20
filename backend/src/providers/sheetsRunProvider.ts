import { IRunProvider } from './runProvider';
import { Run } from '../config/config';
import { logger } from '../utils/logger';

export class SheetsRunProvider implements IRunProvider {
  private runs: Run[] = [];

  async initialize(): Promise<void> {
    // TODO: Implement Google Sheets integration
    // This will load the run list from a Google Sheets template
    logger.info('SheetsRunProvider initialized (stub implementation)');
  }

  getRuns(): Run[] {
    return this.runs;
  }
}
