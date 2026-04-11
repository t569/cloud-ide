import { EnvironmentRecord } from "../models";

/**
 * @interface IEnvironmentRepository
 * @description The Blueprint Registry. Manages static definitions of what a 
 * sandbox should be (e.g., Docker image tags, default allocated CPU/Memory).
 * This is read-heavy and does not map relationally to active sessions.
 */
export interface IEnvironmentRepository {
  save(env: EnvironmentRecord): Promise<void>;
  get(id: string): Promise<EnvironmentRecord | null>;
  list(): Promise<EnvironmentRecord[]>;
  delete(id: string): Promise<void>; // Added the delete method!
}