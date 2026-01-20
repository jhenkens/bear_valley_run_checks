import { Run } from '../config/config';

export interface IRunProvider {
  initialize(): Promise<void>;
  getRuns(): Run[];
}
