import { defaultNetworkPolicy } from './policy';
import type { EnvironmentConfig } from '@cloud-ide/shared';

const env = (over: Partial<EnvironmentConfig> = {}): EnvironmentConfig =>
  ({ id: 'e', name: 'e', baseImage: 'x', buildSteps: [], ...over } as EnvironmentConfig);

const targets = (p: ReturnType<typeof defaultNetworkPolicy>) => p.rules.map((r) => r.target);

describe('defaultNetworkPolicy', () => {
  it('is deny-default — the property that closes cross-tenant injection', () => {
    // A neighbour is reached by raw IP, which matches no domain rule, so deny-default
    // drops it. If this ever flips to allow, the isolation guarantee is gone.
    expect(defaultNetworkPolicy(env()).defaultAction).toBe('deny');
    expect(defaultNetworkPolicy(undefined).defaultAction).toBe('deny');
  });

  it('always allows GitHub — load-bearing across every ecosystem', () => {
    expect(targets(defaultNetworkPolicy(undefined))).toContain('github.com');
  });

  it('allows every known registry regardless of the declared ecosystem', () => {
    // A minimal env declares nothing; it must still reach npm, pypi, crates, … so any
    // toolchain works without the env spelling it out.
    const p = targets(defaultNetworkPolicy(env()));
    expect(p).toEqual(expect.arrayContaining([
      'registry.npmjs.org', 'pypi.org', 'crates.io', 'proxy.golang.org', 'rubygems.org',
    ]));
  });

  it('a node env that never declared an npm build step can still npm install', () => {
    // The exact regression: registry.npmjs.org was gated on an `npm` token that a plain
    // node env need not carry, so `npm install` was denied. It must be allowed now.
    const p = targets(defaultNetworkPolicy(env({ buildSteps: [{ name: 'run', type: 'shell' }] })));
    expect(p).toContain('registry.npmjs.org');
    expect(p).toContain('nodejs.org'); // node-gyp headers for native modules
  });

  it('merges the env-declared escape-hatch domains', () => {
    const p = targets(defaultNetworkPolicy(env({ allowedDomains: ['api.stripe.com', ' '] })));
    expect(p).toContain('api.stripe.com');
    expect(p).not.toContain(' '); // blank entries dropped
  });

  it('a no-environment sandbox still gets registries — and is still deny-default', () => {
    const p = defaultNetworkPolicy(undefined);
    expect(p.defaultAction).toBe('deny'); // raw-IP reach to neighbours stays denied
    expect(targets(p)).toContain('github.com');
    expect(targets(p)).toContain('registry.npmjs.org'); // registries are unconditional now
  });
});
