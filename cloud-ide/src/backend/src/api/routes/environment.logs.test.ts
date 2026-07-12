// Self-check for GET /environment/:envId/builds/:buildId/logs — the route behind a
// clickable build-history row. It has to do two different things through one URL:
// replay a FINISHED build (its POST stream is long gone), and replay-then-FOLLOW a
// live one. The failure modes worth pinning: dropping the tail of a live build,
// hanging open on a finished one, and leaking listeners when the viewer walks away.
import { EventEmitter } from 'events';
import { createEnvironmentRouter } from './environment.routes';
import { BuildService } from '../../services/builder';
import { IEnvironmentRepository, ISandboxRepository } from '../../database/interfaces';

class FakeProc extends EventEmitter {
  cancel(): void {}
}

/** Records everything the handler writes, plus the close hook Express would call. */
function fakeRes() {
  const res: any = {
    statusCode: 200,
    body: undefined as any,
    written: '',
    ended: false,
    headers: {} as Record<string, string>,
    closeHandler: undefined as (() => void) | undefined,
  };
  res.status = (c: number) => ((res.statusCode = c), res);
  res.json = (b: any) => ((res.body = b), res);
  res.setHeader = (k: string, v: string) => void (res.headers[k] = v);
  res.write = (chunk: string) => void (res.written += chunk);
  res.end = (tail?: string) => {
    if (tail) res.written += tail;
    res.ended = true;
  };
  res.on = (event: string, cb: () => void) => {
    if (event === 'close') res.closeHandler = cb;
  };
  return res;
}

/** Pull the logs handler out of the router's stack by path + method. */
function logsHandler(buildService: Partial<BuildService>) {
  const router: any = createEnvironmentRouter(
    {} as IEnvironmentRepository,
    {} as ISandboxRepository,
    buildService as BuildService,
  );
  const layer = router.stack.find(
    (l: any) => l.route?.path === '/:envId/builds/:buildId/logs' && l.route?.methods?.get,
  );
  return layer.route.stack[0].handle as (req: any, res: any) => void;
}

const req = (envId: string, buildId: string) => ({ params: { envId, buildId } });

describe('GET /environment/:envId/builds/:buildId/logs', () => {
  it('replays a finished build and closes — nothing to follow', () => {
    const handle = logsHandler({
      log: () => 'step 1\nstep 2\n',
      runningProcess: () => undefined, // settled
    });
    const res = fakeRes();

    handle(req('env-a', 'b-1'), res);

    expect(res.written).toBe('step 1\nstep 2\n');
    expect(res.ended).toBe(true); // must not hang the viewer on a finished build
  });

  it('replays what a live build has so far, then streams the rest until it settles', () => {
    const proc = new FakeProc();
    const handle = logsHandler({
      log: () => 'already captured\n',
      runningProcess: () => proc as any,
    });
    const res = fakeRes();

    handle(req('env-a', 'b-2'), res);

    // Replayed, but still open — this build is running.
    expect(res.written).toBe('already captured\n');
    expect(res.ended).toBe(false);

    proc.emit('data', 'live chunk\n');
    expect(res.written).toContain('live chunk');
    expect(res.ended).toBe(false);

    proc.emit('succeeded', 'image built');
    expect(res.written).toContain('image built'); // terminating [System] line
    expect(res.ended).toBe(true);
    expect(proc.listenerCount('data')).toBe(0); // detached on settle
  });

  it('detaches when the viewer closes the drawer, and does NOT cancel the build', () => {
    const proc = new FakeProc();
    const cancel = jest.spyOn(proc, 'cancel');
    const handle = logsHandler({ log: () => '', runningProcess: () => proc as any });
    const res = fakeRes();

    handle(req('env-a', 'b-3'), res);
    expect(proc.listenerCount('data')).toBe(1);

    res.closeHandler!(); // Express fires this when the client goes away

    expect(proc.listenerCount('data')).toBe(0); // no leaked listener per viewer
    expect(cancel).not.toHaveBeenCalled(); // a passive observer, unlike POST /build
  });

  it('404s a build whose logs were never captured or have been evicted', () => {
    const handle = logsHandler({ log: () => undefined, runningProcess: () => undefined });
    const res = fakeRes();

    handle(req('env-a', 'b-gone'), res);

    expect(res.statusCode).toBe(404);
  });
});
