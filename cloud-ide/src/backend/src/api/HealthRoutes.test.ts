// Self-check for the health aggregation. The probes themselves are thin wrappers
// around real subsystems; what can actually be wrong here is the rollup (a `down`
// subsystem must not be reported as `ok`) and the isolation (one broken probe must
// not take the endpoint with it).
import { rollup, runProbes, type Probe } from './HealthRoutes';
import type { HealthCheck } from '@cloud-ide/shared/types/health';

const check = (status: HealthCheck['status']): HealthCheck => ({
  name: 'x',
  status,
  detail: '',
  latencyMs: 0,
});

describe('rollup', () => {
  it('is ok only when every check is ok', () => {
    expect(rollup([])).toBe('ok');
    expect(rollup([check('ok'), check('ok')])).toBe('ok');
  });

  it('reports the worst status, not the last or the first', () => {
    expect(rollup([check('ok'), check('degraded')])).toBe('degraded');
    expect(rollup([check('down'), check('ok')])).toBe('down');
    expect(rollup([check('down'), check('degraded')])).toBe('down');
  });
});

describe('runProbes', () => {
  const okProbe: Probe = async () => ({ status: 'ok', detail: 'fine' });
  const throwing: Probe = async () => {
    throw new Error('daemon refused');
  };
  const hanging: Probe = () => new Promise(() => {});

  it('turns a thrown probe into a down check without failing the others', async () => {
    const report = await runProbes({ good: okProbe, bad: throwing });

    expect(report.status).toBe('down');
    expect(report.checks).toHaveLength(2);
    expect(report.checks.find((c) => c.name === 'good')?.status).toBe('ok');
    expect(report.checks.find((c) => c.name === 'bad')).toMatchObject({
      status: 'down',
      detail: 'daemon refused',
    });
  });

  it('times a hanging probe out rather than hanging the endpoint', async () => {
    const report = await runProbes({ stuck: hanging }, 20);

    expect(report.status).toBe('down');
    expect(report.checks[0].detail).toMatch(/timed out/);
  });
});
