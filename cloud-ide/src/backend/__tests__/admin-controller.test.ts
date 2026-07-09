import { AdminController } from '../src/controllers/AdminController';

function createResponse() {
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
  };
}

describe('AdminController', () => {
  it('validates sandbox id before force destroying', async () => {
    const controller = new AdminController({ destroy: jest.fn() } as any);
    const res = createResponse();

    await controller.forceDestroySandbox({ params: {} } as any, res as any);

    expect(res.statusCode).toBe(400);
  });

  it('delegates force destroy to SandboxManager', async () => {
    const sandboxManager = { destroy: jest.fn().mockResolvedValue(true) } as any;
    const controller = new AdminController(sandboxManager);
    const res = createResponse();

    await controller.forceDestroySandbox({ params: { sandboxId: 'sbx-1' } } as any, res as any);

    // Admin god-mode always forces past the dirty-worktree pre-flight
    expect(sandboxManager.destroy).toHaveBeenCalledWith('sbx-1', true);
    expect(res.statusCode).toBe(200);
  });
});
