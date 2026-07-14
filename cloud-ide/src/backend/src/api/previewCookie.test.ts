// The preview runs in a cross-site <iframe> (the IDE embeds it), so the session cookie
// must survive cross-site requests or every asset/HMR request 403s while the token-bearing
// first request 200s. The cookie form adapts to the transport; both branches are guarded
// here against a well-meaning revert.
import { previewCookie, isSecureContext } from './previewCookie';

describe('previewCookie', () => {
  it('carries the token as the cide_preview value', () => {
    expect(previewCookie('sbx-1.999.sig', true).startsWith('cide_preview=sbx-1.999.sig;')).toBe(true);
  });

  it('secure transport: SameSite=None; Secure; Partitioned (works cross-site)', () => {
    const c = previewCookie('t', true);
    expect(c).toMatch(/;\s*SameSite=None(;|$)/i);
    expect(c).toMatch(/;\s*Secure(;|$)/i); // required alongside SameSite=None
    expect(c).toMatch(/;\s*Partitioned(;|$)/i);
    expect(c).toMatch(/;\s*HttpOnly(;|$)/i);
    expect(c).not.toMatch(/SameSite=Lax/i);
  });

  it('insecure transport: SameSite=Lax, no Secure (real-domain preview is same-site)', () => {
    const c = previewCookie('t', false);
    expect(c).toMatch(/;\s*SameSite=Lax(;|$)/i);
    expect(c).not.toMatch(/Secure/i);      // Secure would be rejected over plain HTTP
    expect(c).not.toMatch(/SameSite=None/i); // and None needs Secure, so never here
    expect(c).toMatch(/;\s*HttpOnly(;|$)/i);
  });
});

describe('isSecureContext', () => {
  it('trusts a terminating proxy that reports https', () => {
    expect(isSecureContext({ xForwardedProto: 'https', host: 'ide.example.com' })).toBe(true);
    expect(isSecureContext({ xForwardedProto: 'https, http', host: 'ide.example.com' })).toBe(true);
    expect(isSecureContext({ xForwardedProto: ['https'], host: 'ide.example.com' })).toBe(true);
  });

  it('a proxy reporting http wins over host heuristics', () => {
    expect(isSecureContext({ xForwardedProto: 'http', host: 'sbx-5173.localhost' })).toBe(false);
  });

  it('a direct TLS socket is secure', () => {
    expect(isSecureContext({ encrypted: true, host: 'ide.example.com' })).toBe(true);
  });

  it('loopback hosts are secure contexts even over plain http', () => {
    expect(isSecureContext({ host: 'sbx-5173.localhost' })).toBe(true);
    expect(isSecureContext({ host: 'localhost:3000' })).toBe(true);
    expect(isSecureContext({ host: '127.0.0.1:3000' })).toBe(true);
  });

  it('a plain-http custom domain is NOT secure (falls back to the Lax cookie)', () => {
    expect(isSecureContext({ host: 'sbx-5173.dev.internal' })).toBe(false);
  });
});
