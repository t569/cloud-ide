import { EnvironmentRecord } from './models';

export interface IEnvironmentRepository {
  save(env: EnvironmentRecord): Promise<void>;
  get(id: string): Promise<EnvironmentRecord | null>;
  list(): Promise<EnvironmentRecord[]>;
  delete(id: string): Promise<void>; // Added the delete method!
}