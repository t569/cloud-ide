// The shape of GET /api/health. Shared so the dashboard renders exactly what the
// gateway reports — a new subsystem means a new probe, not a frontend change.

export type HealthStatus = 'ok' | 'degraded' | 'down';

export interface HealthCheck {
  /** Subsystem name, e.g. 'docker', 'opensandbox'. */
  name: string;
  status: HealthStatus;
  /** Human-readable evidence: the version, the counts, or the failure. */
  detail: string;
  latencyMs: number;
}

export interface HealthReport {
  /** Worst status across every check. */
  status: HealthStatus;
  uptimeSec: number;
  timestamp: string;
  checks: HealthCheck[];
}
