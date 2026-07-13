// GET /:id/network resolves a sandbox's effective egress allow-list. The heavy lifting
// (deriving the domains) is policy.test.ts; here we pin the SandboxManager wiring:
// record -> its environment -> defaultNetworkPolicy, plus the enforced flag.
//
// egressCapability is mocked so the test never shells out to docker for the kernel probe.
jest.mock('../src/services/sandbox/network/egressCapability', () => ({
  egressEnforceable: jest.fn().mockResolvedValue(true),
}));

import { SandboxManager } from '../src/services/sandbox/SandboxManager';
import { egressEnforceable } from '../src/services/sandbox/network/egressCapability';

const record = (over: any = {}) => ({
  sandboxId: 'sbx-1', userId: 'u', worktreeId: 'wt', environmentId: 'env-1',
  state: 'RUNNING', desiredVolumes: [], workspaceMountPath: '/workspace',
  requiresReprovision: false, createdAt: 0, ...over,
});

function manager(sandbox: any, env: any) {
  const sandboxRepo = { get: jest.fn().mockResolvedValue(sandbox) } as any;
  const envRepo = { get: jest.fn().mockResolvedValue(env) } as any;
  // driver + worktreeEngine are unused by getNetworkPolicy.
  return new SandboxManager(sandboxRepo, {} as any, {} as any, undefined, envRepo);
}

describe('SandboxManager.getNetworkPolicy', () => {
  it('returns the deny-default allow-list derived from the sandbox environment', async () => {
    const m = manager(
      record(),
      { id: 'env-1', imageName: 'x', builderConfig: { buildSteps: [{ name: 'a', type: 'pip' }] } },
    );

    const { enforced, policy } = await m.getNetworkPolicy('sbx-1');

    expect(enforced).toBe(true);
    expect(policy.defaultAction).toBe('deny');
    const targets = policy.rules.map((r) => r.target);
    expect(targets).toContain('pypi.org');       // from the pip build step
    expect(targets).toContain('github.com');     // always-on common set
  });

  it('reports enforced=false when the host cannot enforce (degraded kernel)', async () => {
    (egressEnforceable as jest.Mock).mockResolvedValueOnce(false);
    const m = manager(record(), { id: 'env-1', imageName: 'x', builderConfig: {} });

    expect((await m.getNetworkPolicy('sbx-1')).enforced).toBe(false);
  });

  it('a sandbox with no environment still gets the safe minimum, deny-default', async () => {
    const m = manager(record({ environmentId: '' }), null);

    const { policy } = await m.getNetworkPolicy('sbx-1');
    expect(policy.defaultAction).toBe('deny');
    expect(policy.rules.map((r) => r.target)).toContain('github.com');
    expect(policy.rules.map((r) => r.target)).not.toContain('pypi.org');
  });

  it('throws for an unknown sandbox', async () => {
    const m = manager(null, null);
    await expect(m.getNetworkPolicy('nope')).rejects.toThrow(/not found/i);
  });
});
