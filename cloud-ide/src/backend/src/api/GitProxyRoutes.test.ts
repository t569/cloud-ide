// The git CORS shim forwards a caller-supplied URL AND the caller's Authorization header,
// so the allow-list is the entire security model. These are the escapes it has to refuse —
// each one is a way to turn this into an SSRF or a credential leak.
import { isAllowedGitUrl } from './GitProxyRoutes';

describe('isAllowedGitUrl', () => {
  it('allows the smart-HTTP endpoints on known git hosts', () => {
    expect(isAllowedGitUrl('https://github.com/o/r.git/info/refs')).toBe(true);
    expect(isAllowedGitUrl('https://github.com/o/r.git/git-upload-pack')).toBe(true);
    expect(isAllowedGitUrl('https://gitlab.com/o/r.git/git-receive-pack')).toBe(true);
    expect(isAllowedGitUrl('https://codeload.github.com/o/r/info/refs')).toBe(true); // subdomain
  });

  it('refuses look-alike hosts', () => {
    // The reason the check is `=== host || endsWith('.' + host)` and never `includes`.
    expect(isAllowedGitUrl('https://github.com.evil.tld/o/r/info/refs')).toBe(false);
    expect(isAllowedGitUrl('https://evil-github.com/o/r/info/refs')).toBe(false);
    expect(isAllowedGitUrl('https://evil.tld/info/refs?x=github.com')).toBe(false);
  });

  it('refuses internal and non-https targets — the SSRF cases', () => {
    // On a cloud host, 169.254.169.254 is the metadata service; localhost is everything
    // else this backend runs.
    expect(isAllowedGitUrl('http://169.254.169.254/latest/meta-data/info/refs')).toBe(false);
    expect(isAllowedGitUrl('https://169.254.169.254/info/refs')).toBe(false);
    expect(isAllowedGitUrl('http://localhost:3000/info/refs')).toBe(false);
    expect(isAllowedGitUrl('http://github.com/o/r/info/refs')).toBe(false); // plain http
    expect(isAllowedGitUrl('file:///etc/passwd')).toBe(false);
    expect(isAllowedGitUrl('not a url')).toBe(false);
  });

  it('refuses anything outside the three smart-HTTP paths', () => {
    // Being on an allowed host is not enough — this must not become a general GitHub proxy.
    expect(isAllowedGitUrl('https://github.com/owner/private-repo')).toBe(false);
    expect(isAllowedGitUrl('https://api.github.com/user')).toBe(false);
    expect(isAllowedGitUrl('https://github.com/o/r/info/refs/../../secrets')).toBe(false);
  });
});
