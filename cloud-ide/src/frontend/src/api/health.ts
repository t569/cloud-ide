import { apiClient, ApiError } from '../lib/apiClient';
import type { HealthReport } from '@cloud-ide/shared/types/health';

/**
 * A `down` report comes back as HTTP 503, which apiClient (correctly) throws on —
 * but the body is still the full report, and it's the one we most want to render.
 * Unwrap it; anything else (network failure, HTML from a dead server) rethrows.
 */
export async function fetchHealth(): Promise<HealthReport> {
  try {
    return await apiClient.get<HealthReport>('/health');
  } catch (err) {
    if (err instanceof ApiError && Array.isArray(err.data?.checks)) return err.data as HealthReport;
    throw err;
  }
}
