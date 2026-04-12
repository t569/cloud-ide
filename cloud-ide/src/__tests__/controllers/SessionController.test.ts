// backend/tests/controllers/SessionController.test.ts

import { EventEmitter } from 'events';
import { SessionController } from '../../backend/src/controllers/SessionController';
import { SandboxManager } from '../../backend/src/services/sandbox/SandboxManager';
import { config } from '../../backend/src/config/env';

// Mock the Rust FFI
jest.mock('../../index.node');

describe('SessionController', () => {
  let controller: SessionController;
  let mockSystemEvents: jest.Mocked<EventEmitter>;
  let mockSessionRepo: any;
  let mockSandboxRepo: any;
  let mockSandboxManager: any;
  let mockReq: any;
  let mockRes: any;

  beforeEach(() => {
    mockSystemEvents = new EventEmitter() as any;
    mockSystemEvents.emit = jest.fn();

    mockSessionRepo = { get: jest.fn() };
    mockSandboxRepo = { getSandboxesByEnvId: jest.fn() };
    mockSandboxManager = { provision: jest.fn() };

    controller = new SessionController(
      mockSystemEvents,
      mockSessionRepo,
      mockSandboxRepo,
      mockSandboxManager
    );

    mockReq = { body: { environmentId: 'zkp-env', userId: 'user-1' }, params: {} };
    mockRes = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    
    config.PUBLIC_API_URL = 'http://localhost:3000';
  });

  it('should route to an existing WARM sandbox if available', async () => {
    // Arrange: Mock the DB to return an already running sandbox
    mockSandboxRepo.getSandboxesByEnvId.mockResolvedValue([
      { sandboxId: 'sbx-warm-123', state: 'RUNNING' }
    ]);

    // Act
    await controller.startSession(mockReq, mockRes);

    // Assert: We should NOT call the Rust provisioner
    expect(mockSandboxManager.provision).not.toHaveBeenCalled();
    
    // Assert: We should link the session to the existing sandbox
    expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
      sandboxId: 'sbx-warm-123',
      websocketUrl: expect.stringContaining('ws://localhost:3000')
    }));
  });

  it('should delegate to Rust for a COLD boot if no warm sandbox exists', async () => {
    // Arrange: Mock DB returns empty (no warm sandboxes)
    mockSandboxRepo.getSandboxesByEnvId.mockResolvedValue([]);
    
    // Mock the Rust Manager returning a newly provisioned sandbox
    mockSandboxManager.provision.mockResolvedValue({
      sandboxId: 'sbx-new-999',
      state: 'RUNNING'
    });

    // Act
    await controller.startSession(mockReq, mockRes);

    // Assert: Rust should be called to boot the infrastructure
    expect(mockSandboxManager.provision).toHaveBeenCalledWith({
      imageTag: 'zkp-env'
    });

    // Assert: Session is linked to the newly generated sandbox
    expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
      sandboxId: 'sbx-new-999'
    }));
    
    // Assert: Background event fired to save to DB
    expect(mockSystemEvents.emit).toHaveBeenCalledWith('session:active', expect.any(Object));
  });
});