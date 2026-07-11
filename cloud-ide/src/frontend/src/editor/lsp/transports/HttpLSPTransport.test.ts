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

  it('routes a request to /lsp/:sandboxId/:lang/:method and reports connected', async () => {
    post.mockResolvedValue([{ path: '/x.py', range: {} }]);
    const t = new HttpLSPTransport('python', 'sb1');

    const result = await t.provideDefinition(definition, new AbortController().signal);

    expect(post).toHaveBeenCalledWith('/lsp/sb1/python/definition', definition, expect.anything());
    expect(result).toHaveLength(1);
    expect(t.getStatus()).toBe('connected');
  });

  it('debounces completions — no network call until the quiet window elapses', async () => {
    post.mockResolvedValue([]);
    const t = new HttpLSPTransport('python', 'sb1', 150);

    const p = t.provideCompletions(completion, new AbortController().signal);
    expect(post).not.toHaveBeenCalled(); // still inside the debounce window

    await vi.advanceTimersByTimeAsync(150);
    await p;
    expect(post).toHaveBeenCalledOnce();
  });

  it('cancels a debounced request when the user keeps typing (never hits the wire)', async () => {
    post.mockResolvedValue([]);
    const t = new HttpLSPTransport('python', 'sb1', 150);
    const ctrl = new AbortController();

    const p = t.provideCompletions(completion, ctrl.signal);
    ctrl.abort(); // superseded by a newer keystroke before the window elapsed

    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(post).not.toHaveBeenCalled();
  });

  it('first sync posts a full-text snapshot to baseline the document', async () => {
    post.mockResolvedValue(undefined);
    const t = new HttpLSPTransport('python', 'sb1');
    const delta = { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: 'x' };

    t.notifyChange('/workspace/main.py', [delta], 'x\n');
    expect(post).not.toHaveBeenCalled(); // debounced
    await vi.advanceTimersByTimeAsync(250);

    expect(post).toHaveBeenCalledWith('/lsp/sb1/python/sync', {
      path: '/workspace/main.py',
      changes: [{ text: 'x\n' }], // full snapshot, not the delta, on the first sync
    });
  });

  it('sends accumulated incremental deltas after the baseline', async () => {
    post.mockResolvedValue(undefined);
    const t = new HttpLSPTransport('python', 'sb1');
    const d1 = { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: 'a' };
    const d2 = { range: { start: { line: 0, character: 1 }, end: { line: 0, character: 1 } }, text: 'b' };

    t.notifyChange('/f.py', [d1], 'a');
    await vi.advanceTimersByTimeAsync(250); // baseline snapshot
    post.mockClear();

    t.notifyChange('/f.py', [d2], 'ab'); // subsequent edit
    await vi.advanceTimersByTimeAsync(250);

    expect(post).toHaveBeenCalledWith('/lsp/sb1/python/sync', { path: '/f.py', changes: [d2] });
  });

  it('resyncs a full snapshot on the flush after a failed sync POST', async () => {
    const t = new HttpLSPTransport('python', 'sb1');
    const d1 = { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: 'a' };
    const d2 = { range: { start: { line: 0, character: 1 }, end: { line: 0, character: 1 } }, text: 'b' };

    post.mockResolvedValueOnce(undefined); // baseline snapshot succeeds
    t.notifyChange('/f.py', [d1], 'a');
    await vi.advanceTimersByTimeAsync(250);
    post.mockClear();

    post.mockRejectedValueOnce(new ApiError('boom', 500)); // this delta POST fails
    t.notifyChange('/f.py', [d2], 'ab');
    await vi.advanceTimersByTimeAsync(250);
    expect(post).toHaveBeenCalledWith('/lsp/sb1/python/sync', { path: '/f.py', changes: [d2] });
    post.mockClear();

    // Next edit must re-baseline with the full buffer, not the lone new delta —
    // the server may have missed the dropped one.
    post.mockResolvedValueOnce(undefined);
    const d3 = { range: { start: { line: 0, character: 2 }, end: { line: 0, character: 2 } }, text: 'c' };
    t.notifyChange('/f.py', [d3], 'abc');
    await vi.advanceTimersByTimeAsync(250);
    expect(post).toHaveBeenCalledWith('/lsp/sb1/python/sync', { path: '/f.py', changes: [{ text: 'abc' }] });
  });

  it('degrades to empty + offline when the backend is unreachable', async () => {
    post.mockRejectedValue(new ApiError('Network failure', 0));
    const t = new HttpLSPTransport('python', 'sb1');

    const result = await t.provideDefinition(definition, new AbortController().signal);

    expect(result).toEqual([]); // fallback, not a throw — typing keeps working
    expect(t.getStatus()).toBe('offline');
  });
});
