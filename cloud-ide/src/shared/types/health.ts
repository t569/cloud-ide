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
  /**
   * Optional labeled stats shown when the card is expanded (e.g. per-server
   * counts). Generic on purpose — any probe can attach them; the dashboard
   * renders whatever is here without knowing the subsystem.
   */
  metrics?: Record<string, string | number>;
  /**
   * Optional nested checks — a subsystem made of many parts (e.g. one LSP server
   * per language) reports each as a child. Rendered recursively as the same row.
   */
  children?: HealthCheck[];
}

export interface HealthReport {
  /** Worst status across every check. */
  status: HealthStatus;
  uptimeSec: number;
  timestamp: string;
  checks: HealthCheck[];
}
