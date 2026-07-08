// Registry qualification ($DOCKER_REGISTRY) + the rollback trust boundary.
// qualify/stripRegistry read the env live, so we toggle it per-case.
import { qualify, stripRegistry, toImageName, isValidImageRef } from '@cloud-ide/shared';

const REG = 'reg.example.com:5000';

// Mirror of the route guard (environment.routes.ts): a tag is accepted iff its
// bare form is a valid ref AND belongs to THIS env.
const accepts = (envId: string, tag: unknown): boolean => {
  const bare = typeof tag === 'string' ? stripRegistry(tag) : '';
  return isValidImageRef(bare) && bare.startsWith(`cloud-ide-${envId}:`);
};

afterEach(() => {
  delete process.env.DOCKER_REGISTRY;
});

describe('registry qualification', () => {
  it('is a no-op when $DOCKER_REGISTRY is unset', () => {
    expect(qualify('cloud-ide-env-x:latest')).toBe('cloud-ide-env-x:latest');
    expect(stripRegistry('cloud-ide-env-x:latest')).toBe('cloud-ide-env-x:latest');
    expect(toImageName('env-x')).toBe('cloud-ide-env-x:latest');
  });

  it('prefixes then strips back the host when set (roundtrip)', () => {
    process.env.DOCKER_REGISTRY = REG;
    const q = qualify('cloud-ide-env-x:abc');
    expect(q).toBe(`${REG}/cloud-ide-env-x:abc`);
    expect(stripRegistry(q)).toBe('cloud-ide-env-x:abc');
    expect(toImageName('env-x')).toBe(`${REG}/cloud-ide-env-x:latest`);
  });
});

describe('rollback trust boundary', () => {
  it('accepts this env’s own tag, qualified or bare', () => {
    process.env.DOCKER_REGISTRY = REG;
    expect(accepts('env-x', `${REG}/cloud-ide-env-x:abc`)).toBe(true);
  });

  it('rejects a foreign registry, another env, and junk', () => {
    process.env.DOCKER_REGISTRY = REG;
    expect(accepts('env-x', 'evil.com/cloud-ide-env-x:abc')).toBe(false); // foreign host → leftover '/'
    expect(accepts('env-x', `${REG}/cloud-ide-env-y:abc`)).toBe(false); // wrong env
    expect(accepts('env-x', '../../etc/passwd')).toBe(false);
    expect(accepts('env-x', 42)).toBe(false);
  });
});
