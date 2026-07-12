// Self-check for the health aggregation. The probes themselves are thin wrappers
// around real subsystems; what can actually be wrong here is the rollup (a `down`
// subsystem must not be reported as `ok`) and the isolation (one broken probe must
// not take the endpoint with it).
import { rollup, runProbes, probeLspServers, type Probe } from './HealthRoutes';
import type { HealthCheck } from '@cloud-ide/shared/types/health';
import type { LspServerConfig } from '../services/lsp/LspProxy';

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

describe('probeLspServers', () => {
  const servers = (spec: Record<string, [string, number]>) =>
    new Map<string, LspServerConfig>(
      Object.entries(spec).map(([l, [host, port]]) => [l, { kind: 'tcp', host, port }]),
    );

  it('is ok with no servers configured (LSP is optional)', async () => {
    const v = await probeLspServers(new Map(), 0);
    expect(v.status).toBe('ok');
    expect(v.children).toBeUndefined();
    expect(v.metrics).toMatchObject({ configured: 0 });
  });

  it('emits a child per server and rolls partial reachability up to degraded', async () => {
    const reach = async (host: string) => {
      if (host === 'dead') throw new Error('ECONNREFUSED');
    };
    const v = await probeLspServers(servers({ python: ['ok', 1], go: ['dead', 2] }), 3, reach);

    expect(v.status).toBe('degraded'); // NOT down — a dead LSP must not 503 the node
    expect(v.metrics).toMatchObject({ configured: 2, reachable: 1, sessions: 3 });
    expect(v.children?.map((c) => c.status)).toEqual(['ok', 'down']);
  });

  it('is ok when every server is reachable', async () => {
    const v = await probeLspServers(servers({ python: ['ok', 1] }), 0, async () => {});
    expect(v.status).toBe('ok');
  });
});
