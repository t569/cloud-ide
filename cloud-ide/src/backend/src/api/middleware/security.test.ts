// Self-check for the identity seam (auth.ts) and the IDOR guard (security.ts).
// These two files are the whole of "who are you" and "what may you touch", so the
// cases below are the security contract, not incidental coverage.
import { Request, Response } from 'express';
import { userOwnsSandbox, requireSandboxOwnership } from './security';
import { currentUser, readUserId, attachUser, UID_COOKIE } from './auth';
import { ISandboxRepository } from '../../database/interfaces';
import { SandboxRecord } from '@cloud-ide/shared/types/sandbox';

const ALICE = 'user-alice';
const BOB = 'user-bob';

function record(over: Partial<SandboxRecord> = {}): SandboxRecord {
  return {
    sandboxId: 'sbx-1',
    userId: ALICE,
    worktreeId: 'wt-1',
    environmentId: 'node-env',
    state: 'RUNNING',
    desiredVolumes: [],
    workspaceMountPath: '/workspace',
    requiresReprovision: false,
    createdAt: 0,
    ...over,
  };
}

function repoReturning(value: SandboxRecord | null): ISandboxRepository {
  return { get: jest.fn(async () => value) } as unknown as ISandboxRepository;
}

function fakeRes() {
  const cookies: Record<string, unknown> = {};
  const res = {
    cookies,
    statusCode: 0,
    body: undefined as unknown,
    cookie: (name: string, value: string, opts?: unknown) => {
      cookies[name] = { value, opts };
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & typeof res;
}

const reqWithCookie = (cookie?: string) =>
  ({ headers: cookie ? { cookie } : {} }) as unknown as Request;

describe('auth — the identity seam', () => {
  it('mints an anonymous uid on first contact and sets it httpOnly', () => {
    const req = reqWithCookie();
    const res = fakeRes();

    const uid = currentUser(req, res);

    expect(uid).toMatch(/^[0-9a-f-]{36}$/); // randomUUID
    const cookie = res.cookies[UID_COOKIE] as { value: string; opts: any };
    expect(cookie.value).toBe(uid);
    // Not JS-readable: the uid is a bearer token, so XSS must not be able to lift it.
    expect(cookie.opts.httpOnly).toBe(true);
    // Must be visible to middleware later in THIS request, before the cookie returns.
    expect(req.userId).toBe(uid);
  });

  it('reuses an existing uid rather than re-minting', () => {
    const res = fakeRes();
    expect(currentUser(reqWithCookie(`${UID_COOKIE}=${ALICE}`), res)).toBe(ALICE);
    expect(res.cookies[UID_COOKIE]).toBeUndefined(); // no new cookie issued
  });

  it('is idempotent once resolved — a second call must not mint a rival cookie', () => {
    const req = reqWithCookie();
    const res = fakeRes();
    const first = currentUser(req, res);
    const second = currentUser(req, res); // e.g. attachUser, then a controller
    expect(second).toBe(first);
    expect((res.cookies[UID_COOKIE] as { value: string }).value).toBe(first);
  });

  it('readUserId never mints — a WS upgrade has no response to set a cookie on', () => {
    expect(readUserId(`${UID_COOKIE}=${ALICE}; other=1`)).toBe(ALICE);
    expect(readUserId(undefined)).toBeUndefined();
    expect(readUserId('other=1')).toBeUndefined();
  });

  it('attachUser populates req.userId', () => {
    const req = reqWithCookie(`${UID_COOKIE}=${BOB}`);
    const next = jest.fn();
    attachUser(req, fakeRes(), next);
    expect(req.userId).toBe(BOB);
    expect(next).toHaveBeenCalled();
  });
});

describe('userOwnsSandbox', () => {
  it('allows the owner', async () => {
    expect(await userOwnsSandbox(repoReturning(record()), ALICE, 'sbx-1')).toBe(true);
  });

  it('denies a different user — this is the whole IDOR guard', async () => {
    expect(await userOwnsSandbox(repoReturning(record()), BOB, 'sbx-1')).toBe(false);
  });

  it('denies when the caller has no identity (unauthenticated WS upgrade)', async () => {
    expect(await userOwnsSandbox(repoReturning(record()), undefined, 'sbx-1')).toBe(false);
  });

  it('denies an unknown sandbox (404, so ids cannot be enumerated)', async () => {
    expect(await userOwnsSandbox(repoReturning(null), ALICE, 'sbx-1')).toBe(false);
  });

  it('denies when no sandboxId is supplied', async () => {
    expect(await userOwnsSandbox(repoReturning(record()), ALICE, undefined)).toBe(false);
  });

  it('fails closed when the repository throws', async () => {
    const repo = { get: jest.fn(async () => { throw new Error('disk gone'); }) } as unknown as ISandboxRepository;
    expect(await userOwnsSandbox(repo, ALICE, 'sbx-1')).toBe(false);
  });

  // ponytail: this is the legacy-adoption hole. It must die with the stub.
  it('adopts pre-auth records that carry no owner', async () => {
    const legacy = repoReturning(record({ userId: undefined }));
    expect(await userOwnsSandbox(legacy, ALICE, 'sbx-1')).toBe(true);
    expect(await userOwnsSandbox(legacy, BOB, 'sbx-1')).toBe(true);
  });
});

describe('requireSandboxOwnership', () => {
  const call = async (repo: ISandboxRepository, userId?: string) => {
    const req = { method: 'GET', params: { sandboxId: 'sbx-1' }, userId } as unknown as Request;
    const res = fakeRes();
    const next = jest.fn();
    await requireSandboxOwnership(repo)(req, res, next);
    return { res, next };
  };

  it('passes the owner through', async () => {
    const { next, res } = await call(repoReturning(record()), ALICE);
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(0);
  });

  it('404s a non-owner — not 403, so ids cannot be probed', async () => {
    const { next, res } = await call(repoReturning(record()), BOB);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  it('404s a caller with no identity', async () => {
    const { next, res } = await call(repoReturning(record()), undefined);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(404);
  });
});
