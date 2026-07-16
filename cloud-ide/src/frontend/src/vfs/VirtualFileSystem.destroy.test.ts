// destroy() must flush pending edits — unmount (navigate away, Detach) fires it,
// and dropping the queue there loses the last ≤2s of typing.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VirtualFileSystem } from './VirtualFileSystem';
import { apiClient } from '../lib/apiClient';

vi.mock('../lib/apiClient', () => ({
  apiClient: { post: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue({}) },
}));

beforeEach(() => {
  vi.stubGlobal('window', { setInterval: () => 1, clearInterval: () => {} });
  vi.mocked(apiClient.post).mockClear();
});

describe('VirtualFileSystem.destroy', () => {
  it('flushes queued edits instead of dropping them', () => {
    const vfs = new VirtualFileSystem('sbx', () => {});
    vfs.applyPatch([{ kind: 'add', path: '/workspace/a.ts' }]);
    vfs.updateFile('/workspace/a.ts', 'last keystrokes'); // queued, debounce not fired

    vfs.destroy();

    expect(apiClient.post).toHaveBeenCalledWith('/fs/sbx/write', {
      path: '/workspace/a.ts',
      content: 'last keystrokes',
    });
  });
});
