import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { SandboxController } from '../src/controllers/SandboxController';

function createJsonResponse() {
  return {
    statusCode: 200,
    payload: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.payload = payload;
      return this;
    },
    setHeader: jest.fn(),
    flushHeaders: jest.fn(),
    headersSent: false,
  };
}

function createStreamResponse() {
  const stream = new PassThrough() as PassThrough & {
    statusCode?: number;
    payload?: unknown;
    headersSent?: boolean;
    status?: (code: number) => typeof stream;
    json?: (payload: unknown) => typeof stream;
    setHeader?: jest.Mock;
    flushHeaders?: jest.Mock;
  };
  let body = '';
  stream.on('data', (chunk) => {
    body += chunk.toString();
  });
  stream.statusCode = 200;
  stream.headersSent = false;
  stream.status = (code: number) => {
    stream.statusCode = code;
    return stream;
  };
  stream.json = (payload: unknown) => {
    stream.payload = payload;
    stream.end();
    return stream;
  };
  stream.setHeader = jest.fn();
  stream.flushHeaders = jest.fn(() => {
    stream.headersSent = true;
  });

  return { stream, getBody: () => body };
}

describe('SandboxController', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('validates sandbox creation requests', async () => {
    const manager = { provision: jest.fn() } as any;
    const controller = new SandboxController(manager);
    const res = createJsonResponse();

    await controller.createSandbox({ body: {} } as any, res as any);

    expect(res.statusCode).toBe(400);
    expect(res.payload).toEqual({ error: 'imageTag is required.' });
  });

  it('creates a sandbox through the manager', async () => {
    const manager = {
      provision: jest.fn().mockResolvedValue({ sandboxId: 'sbx-1', state: 'RUNNING' }),
    } as any;
    const controller = new SandboxController(manager);
    const res = createJsonResponse();

    // userId is set upstream by attachUser; the caller becomes the sandbox's owner.
    const req = { body: { imageTag: 'node-env:latest' }, userId: 'user-1' } as any;
    await controller.createSandbox(req, res as any);

    expect(manager.provision).toHaveBeenCalledWith({ imageTag: 'node-env:latest' }, 'user-1');
    expect(res.statusCode).toBe(201);
  });

  it('never lets the request body dictate the sandbox owner', async () => {
    const manager = {
      provision: jest.fn().mockResolvedValue({ sandboxId: 'sbx-1', state: 'RUNNING' }),
    } as any;
    const controller = new SandboxController(manager);
    const req = {
      body: { imageTag: 'node-env:latest', userId: 'victim' },
      userId: 'attacker',
    } as any;

    await controller.createSandbox(req, createJsonResponse() as any);

    expect(manager.provision).toHaveBeenCalledWith(expect.anything(), 'attacker');
  });

  it('proxies exec SSE streams without exposing token details to callers', async () => {
    const manager = {
      // Wake-on-Demand checks state before resolving the exec connection
      getStatus: jest.fn().mockResolvedValue({ sandboxId: 'sbx-1', state: 'RUNNING' }),
      resolveExecConnection: jest.fn().mockResolvedValue({
        baseUrl: 'http://execd.internal',
        accessToken: 'secret-token',
      }),
    } as any;
    const controller = new SandboxController(manager);
    const req = Object.assign(new EventEmitter(), {
      params: { sandboxId: 'sbx-1' },
      body: { command: ['/bin/sh', '-c', 'echo hi'] },
    });
    const { stream: res, getBody } = createStreamResponse();
    const upstream = new Response('data: {"type":"stdout","text":"hello"}\n', {
      headers: { 'content-type': 'text/event-stream' },
    });
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(upstream);

    await controller.execCommand(req as any, res as any);
    await new Promise((resolve) => res.on('finish', resolve));

    expect(manager.resolveExecConnection).toHaveBeenCalledWith('sbx-1');
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://execd.internal/command',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-EXECD-ACCESS-TOKEN': 'secret-token',
        }),
      })
    );
    expect(getBody()).toContain('hello');
  });

  it('returns restartRequired on volume attach operations', async () => {
    const manager = {
      attachVolume: jest.fn().mockResolvedValue({
        restartRequired: true,
        sandbox: { sandboxId: 'sbx-9' },
      }),
    } as any;
    const controller = new SandboxController(manager);
    const res = createJsonResponse();

    await controller.attachVolume(
      {
        params: { sandboxId: 'sbx-9' },
        body: { name: 'cache', hostPath: '/host/cache', mountPath: '/ignored' },
      } as any,
      res as any
    );

    expect(manager.attachVolume).toHaveBeenCalledWith(
      'sbx-9',
      expect.objectContaining({ name: 'cache', kind: 'user' })
    );
    expect(res.payload).toEqual({
      restartRequired: true,
      sandbox: { sandboxId: 'sbx-9' },
    });
  });
});
