import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { HttpLSPTransport } from './HttpLSPTransport';
import { CompletionParams, DefinitionParams } from '../types';

// Mock only apiClient.post; keep the real ApiError so status classification works.
vi.mock('../../../lib/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/apiClient')>();
  return { ...actual, apiClient: { ...actual.apiClient, post: vi.fn() } };
});
import { apiClient, ApiError } from '../../../lib/apiClient';
const post = apiClient.post as unknown as Mock;

const completion: CompletionParams = {
  path: '/x.py', languageId: 'python', position: { line: 0, character: 0 }, prefix: '',
};
const definition: DefinitionParams = {
  path: '/x.py', languageId: 'python', position: { line: 0, character: 0 },
};

describe('HttpLSPTransport', () => {
  beforeEach(() => {
    post.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('routes a request to /lsp/:lang/:method and reports connected', async () => {
    post.mockResolvedValue([{ path: '/x.py', range: {} }]);
    const t = new HttpLSPTransport('python');

    const result = await t.provideDefinition(definition, new AbortController().signal);

    expect(post).toHaveBeenCalledWith('/lsp/python/definition', definition, expect.anything());
    expect(result).toHaveLength(1);
    expect(t.getStatus()).toBe('connected');
  });

  it('debounces completions — no network call until the quiet window elapses', async () => {
    post.mockResolvedValue([]);
    const t = new HttpLSPTransport('python', 150);

    const p = t.provideCompletions(completion, new AbortController().signal);
    expect(post).not.toHaveBeenCalled(); // still inside the debounce window

    await vi.advanceTimersByTimeAsync(150);
    await p;
    expect(post).toHaveBeenCalledOnce();
  });

  it('cancels a debounced request when the user keeps typing (never hits the wire)', async () => {
    post.mockResolvedValue([]);
    const t = new HttpLSPTransport('python', 150);
    const ctrl = new AbortController();

    const p = t.provideCompletions(completion, ctrl.signal);
    ctrl.abort(); // superseded by a newer keystroke before the window elapsed

    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(post).not.toHaveBeenCalled();
  });

  it('degrades to empty + offline when the backend is unreachable', async () => {
    post.mockRejectedValue(new ApiError('Network failure', 0));
    const t = new HttpLSPTransport('python');

    const result = await t.provideDefinition(definition, new AbortController().signal);

    expect(result).toEqual([]); // fallback, not a throw — typing keeps working
    expect(t.getStatus()).toBe('offline');
  });
});
