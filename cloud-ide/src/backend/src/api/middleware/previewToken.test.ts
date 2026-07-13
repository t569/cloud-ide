import { mintPreviewToken, verifyPreviewToken } from './auth';

describe('preview access tokens', () => {
  it('a freshly minted token verifies for its sandbox', () => {
    const t = mintPreviewToken('sbx-1');
    expect(verifyPreviewToken(t, 'sbx-1')).toBe(true);
  });

  it('a token for one sandbox does not open another', () => {
    const t = mintPreviewToken('sbx-1');
    expect(verifyPreviewToken(t, 'sbx-2')).toBe(false);
  });

  it('rejects a tampered signature and garbage', () => {
    const t = mintPreviewToken('sbx-1');
    expect(verifyPreviewToken(t + 'x', 'sbx-1')).toBe(false);
    expect(verifyPreviewToken('not.a.token', 'sbx-1')).toBe(false);
    expect(verifyPreviewToken(undefined, 'sbx-1')).toBe(false);
  });

  it('rejects an expired token', () => {
    jest.isolateModules(() => {
      process.env.PREVIEW_TOKEN_TTL_MS = '-1000'; // exp lands in the past
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const m = require('./auth');
      const expired = m.mintPreviewToken('sbx-1');
      delete process.env.PREVIEW_TOKEN_TTL_MS;
      expect(m.verifyPreviewToken(expired, 'sbx-1')).toBe(false);
    });
  });
});
