// Boot-guard for the execd token. If this ever stops throwing in production, a shared
// deployment silently becomes cross-tenant-exploitable — so the throw is the whole point.
describe('assertSecureProductionConfig', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
    jest.resetModules();
  });

  // Re-import per test so the module reads the env we just set (config is frozen at load).
  const load = () => {
    jest.resetModules();
    return require('./env');
  };

  it('refuses to boot in production without the execd token', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.OPENSANDBOX_EXECD_ACCESS_TOKEN;
    const { assertSecureProductionConfig } = load();
    expect(() => assertSecureProductionConfig()).toThrow(/OPENSANDBOX_EXECD_ACCESS_TOKEN/);
  });

  it('boots in production when the token is set', () => {
    process.env.NODE_ENV = 'production';
    process.env.OPENSANDBOX_EXECD_ACCESS_TOKEN = 'a-real-secret';
    const { assertSecureProductionConfig } = load();
    expect(() => assertSecureProductionConfig()).not.toThrow();
  });

  it('only warns in development — an empty token must not block local work', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.OPENSANDBOX_EXECD_ACCESS_TOKEN;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { assertSecureProductionConfig } = load();
    expect(() => assertSecureProductionConfig()).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// SameSite is decided from the deployment shape, and getting it wrong doesn't degrade
// — it silently drops the session cookie on every credentialed request, so the editor,
// the preview iframe and the raw-image route all 404 with no error near the cause.
describe('cross-site cookie detection', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    jest.resetModules();
  });
  const load = () => {
    jest.resetModules();
    return require('./env');
  };

  it('treats the local dev pair as SAME-site — ports do not make a site', () => {
    process.env.FRONTEND_ORIGIN = 'http://localhost:5173';
    process.env.PUBLIC_API_URL = 'http://localhost:3000';
    expect(load().CROSS_SITE_COOKIES).toBe(false); // => SameSite=Lax, no HTTPS needed
  });

  it('treats a split app/API deployment as cross-site', () => {
    process.env.FRONTEND_ORIGIN = 'https://app.example.com';
    process.env.PUBLIC_API_URL = 'https://api.example.com';
    expect(load().CROSS_SITE_COOKIES).toBe(true); // => SameSite=None; Secure
  });

  it('refuses to boot cross-site over plain HTTP — the browser would drop every cookie', () => {
    process.env.NODE_ENV = 'development';
    process.env.FRONTEND_ORIGIN = 'http://app.example.com';
    process.env.PUBLIC_API_URL = 'http://api.example.com';
    const { assertSecureProductionConfig } = load();
    expect(() => assertSecureProductionConfig()).toThrow(/SameSite=None/);
  });

  it('boots cross-site over HTTPS', () => {
    process.env.NODE_ENV = 'production';
    process.env.OPENSANDBOX_EXECD_ACCESS_TOKEN = 'a-real-secret';
    process.env.FRONTEND_ORIGIN = 'https://app.example.com';
    process.env.PUBLIC_API_URL = 'https://api.example.com';
    const { assertSecureProductionConfig } = load();
    expect(() => assertSecureProductionConfig()).not.toThrow();
  });
});
