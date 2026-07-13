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

  it('allows the registries for an ecosystem declared via build steps', () => {
    const p = targets(defaultNetworkPolicy(env({ buildSteps: [{ name: 'x', type: 'pip' }] })));
    expect(p).toEqual(expect.arrayContaining(['pypi.org', 'files.pythonhosted.org']));
  });

  it('also derives registries from language servers, not only build steps', () => {
    const p = targets(defaultNetworkPolicy(env({ languageServers: ['rust'] })));
    expect(p).toEqual(expect.arrayContaining(['crates.io', 'index.crates.io', 'static.crates.io']));
  });

  it('unions every ecosystem the env touches', () => {
    const p = targets(
      defaultNetworkPolicy(
        env({ buildSteps: [{ name: 'a', type: 'npm' }, { name: 'b', type: 'go' }] }),
      ),
    );
    expect(p).toEqual(expect.arrayContaining(['registry.npmjs.org', 'proxy.golang.org']));
  });

  it('merges the env-declared escape-hatch domains', () => {
    const p = targets(defaultNetworkPolicy(env({ allowedDomains: ['api.stripe.com', ' '] })));
    expect(p).toContain('api.stripe.com');
    expect(p).not.toContain(' '); // blank entries dropped
  });

  it('an unknown ecosystem token is ignored, not a crash', () => {
    const p = defaultNetworkPolicy(env({ buildSteps: [{ name: 'x', type: 'shell' }] }));
    // shell has no registry; falls back to just the common set
    expect(targets(p)).toEqual(['codeload.github.com', 'github.com', 'objects.githubusercontent.com', 'raw.githubusercontent.com']);
  });

  it('a no-environment sandbox gets the safe minimum, still deny-default', () => {
    const p = defaultNetworkPolicy(undefined);
    expect(p.defaultAction).toBe('deny');
    expect(targets(p)).toContain('github.com');
    expect(targets(p)).not.toContain('pypi.org'); // no ecosystem known
  });
});
