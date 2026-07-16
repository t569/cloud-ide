// Persistent per-user package caches: provision must mount /cide-cache and point
// every ecosystem's cache env var into it — with the env's own values winning.
import { CACHE_ENV, CACHE_MOUNT_PATH, cacheVolumeFor } from '../src/services/sandbox/cacheVolumes';

describe('cacheVolumes', () => {
  it('maps every ecosystem cache under the mount path', () => {
    for (const v of Object.values(CACHE_ENV)) {
      expect(v.startsWith(`${CACHE_MOUNT_PATH}/`)).toBe(true);
    }
    expect(CACHE_ENV.GOMODCACHE).toBe('/cide-cache/go/mod');
  });

  it('creates a per-user host dir and an exact-path (non-normalizable) mount', async () => {
    const vol = await cacheVolumeFor('user-abc');
    expect(vol.mountPath).toBe(CACHE_MOUNT_PATH);
    expect(vol.hostPath).toContain('user-abc');
    expect(vol.readOnly).toBe(false);

    const anon = await cacheVolumeFor('');
    expect(anon.hostPath).toContain('anon'); // ownerless raw-verb sandboxes share one dir
  });

  it('env-declared vars beat the cache defaults (spread order contract)', () => {
    const merged: Record<string, string> = { ...CACHE_ENV, GOMODCACHE: '/custom' };
    expect(merged.GOMODCACHE).toBe('/custom');
    expect(merged.PIP_CACHE_DIR).toBe(`${CACHE_MOUNT_PATH}/pip`);
  });
});
