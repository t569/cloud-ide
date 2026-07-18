// Native-fetch GitHub browse: URL construction, tree parsing, base64 decode, auth
// header, and status passthrough are the logic — all exercised against a mocked fetch
// so the test is hermetic (no network, no rate limit).
import { GitHubBrowse, GitHubError } from './GitHubBrowse';

function ok(body: any) {
  return { ok: true, status: 200, json: async () => body, text: async () => '' };
}
function fail(status: number, body = 'nope') {
  return { ok: false, status, json: async () => ({}), text: async () => body };
}

describe('GitHubBrowse', () => {
  let fetchMock: jest.Mock;
  let gh: GitHubBrowse;

  beforeEach(() => {
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
    gh = new GitHubBrowse();
  });

  it('resolves the default branch then fetches the recursive tree', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ default_branch: 'main' }))
      .mockResolvedValueOnce(ok({
        sha: 'root', truncated: false,
        tree: [
          { path: 'src', type: 'tree', sha: 't1' },
          { path: 'src/a.ts', type: 'blob', sha: 'b1', size: 12 },
          { path: 'weird', type: 'commit', sha: 's1' }, // submodule — filtered out
        ],
      }));

    const tree = await gh.getTree('octocat', 'Hello-World');

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/repos/octocat/Hello-World');
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.github.com/repos/octocat/Hello-World/git/trees/main?recursive=1');
    expect(tree.truncated).toBe(false);
    expect(tree.entries).toEqual([
      { path: 'src', type: 'tree', sha: 't1', size: undefined },
      { path: 'src/a.ts', type: 'blob', sha: 'b1', size: 12 },
    ]);
  });

  it('skips the meta call when a branch is given, and passes the token as Bearer', async () => {
    fetchMock.mockResolvedValueOnce(ok({ sha: 'r', truncated: true, tree: [] }));

    const tree = await gh.getTree('o', 'r', { branch: 'dev', token: 'ghp_x' });

    expect(fetchMock).toHaveBeenCalledTimes(1); // no default-branch lookup
    expect(fetchMock.mock.calls[0][0]).toContain('/git/trees/dev?recursive=1');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer ghp_x');
    expect(tree.truncated).toBe(true);
  });

  it('sends no Authorization header when unauthenticated', async () => {
    fetchMock.mockResolvedValueOnce(ok({ sha: 'r', truncated: false, tree: [] }));
    await gh.getTree('o', 'r', { branch: 'main' });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it('decodes base64 file content', async () => {
    fetchMock.mockResolvedValueOnce(ok({ type: 'file', encoding: 'base64', content: Buffer.from('hello π').toString('base64') }));
    expect(await gh.getContent('o', 'r', 'README.md')).toBe('hello π');
  });

  it('rejects a directory path as not-a-file', async () => {
    fetchMock.mockResolvedValueOnce(ok([{ name: 'a' }, { name: 'b' }])); // contents API returns an array for dirs
    await expect(gh.getContent('o', 'r', 'src')).rejects.toThrow(/directory/);
  });

  it('mirrors GitHub status in a GitHubError', async () => {
    fetchMock.mockResolvedValue(fail(404, 'Not Found')); // every call fails
    await expect(gh.getTree('o', 'r', { branch: 'main' })).rejects.toMatchObject({ status: 404 });
    await expect(gh.getTree('o', 'r', { branch: 'main' })).rejects.toBeInstanceOf(GitHubError);
  });

  it('encodes path segments (no injection) but keeps slashes', async () => {
    fetchMock.mockResolvedValueOnce(ok({ type: 'file', encoding: 'base64', content: '' }));
    await gh.getContent('o', 'r', 'a b/c?.ts');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/repos/o/r/contents/a%20b/c%3F.ts');
  });
});
