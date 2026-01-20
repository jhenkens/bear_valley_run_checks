import { IRunProvider } from './runProvider';
import { Run } from '../config/config';

export class SheetsRunProvider implements IRunProvider {
  private runs: Run[] = [];

  async initialize(): Promise<void> {
    // TODO: Implement Google Sheets integration
    // This will load the run list from a Google Sheets template
    console.log('SheetsRunProvider initialized (stub implementation)');
  }

  getRuns(): Run[] {
    return this.runs;
  }
}
