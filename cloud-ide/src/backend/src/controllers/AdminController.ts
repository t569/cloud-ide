// backend/src/controllers/AdminController.ts


import { Request, Response } from 'express';
import { SandboxManager } from '../services/sandbox/SandboxManager';

/**
 * @class AdminController
 * @description The infrastructure override. This provides strict, "god-mode" 
 * API endpoints to manually manage the Data Plane, bypassing the standard 
 * user-session lifecycle.
 */
export class AdminController {
  constructor(
    private sandboxManager: SandboxManager,
    // private sandboxRepo: ISandboxRepository
  ) {}

  /**
   * @route DELETE /api/v1/admin/sandboxes/:sandboxId
   * @description Hard-kills a compute container and flushes it from the Rust 
   * engine's memory map. Used for internal dashboarding or emergency cleanup.
   */
  public forceDestroySandbox = async (req: Request, res: Response): Promise<void> => {
    // Handling the type error you mentioned in Q4 here safely!
    const sandboxId = Array.isArray(req.params.sandboxId) 
      ? req.params.sandboxId[0] 
      : req.params.sandboxId;

    if (!sandboxId || typeof sandboxId !== 'string') {
      res.status(400).json({ error: 'Valid Sandbox ID required.' });
      return;
    }

    try {
      // Tell Rust to kill the container entirely
      await this.sandboxManager.destroy(sandboxId);
      res.status(200).json({ message: `Sandbox ${sandboxId} obliterated.` });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  };
}
