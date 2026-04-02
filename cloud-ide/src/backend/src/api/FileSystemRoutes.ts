// backend/src/api/FileSystemRoutes.ts
import { Router, Request, Response, NextFunction } from 'express';
import { FileSystemManager } from '../services/FileSystemManager';

export function createFileSystemRouter(): Router {
  const router = Router();
  const fsManager = new FileSystemManager();

  /**
   * PARAMETER VALIDATION MIDDLEWARE
   * Intercepts any route containing ':sandboxId' and validates it first.
   */
  router.param('sandboxId', (req: Request, res: Response, next: NextFunction, id: string) => {
    // 1. Check if it exists and is a string
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Invalid sandboxId: Must be a string.' });
    }

    // 2. Prevent empty strings or whitespace-only strings
    if (id.trim() === '') {
      return res.status(400).json({ error: 'Invalid sandboxId: Cannot be empty.' });
    }

    // 3. Optional: Regex to ensure it only contains safe characters (alphanumeric, dashes, underscores)
    // This prevents malicious users from injecting shell operators like ';', '|', or '&' into the ID.
    const safeIdRegex = /^[a-zA-Z0-9_-]+$/;
    if (!safeIdRegex.test(id)) {
      return res.status(400).json({ error: 'Invalid sandboxId: Contains illegal characters.' });
    }

    // If it passes all checks, proceed to the actual route handler
    next();
  });

  /**
   * GET /api/fs/:sandboxId/ls?path=/workspace
   */
  router.get('/:sandboxId/ls', async (req: Request, res: Response) => {
    try {
      const { sandboxId } = req.params;
      const targetPath = (req.query.path as string) || '/workspace';
    
      if(!sandboxId || typeof sandboxId !== 'string'){
            return res.status(400).json({error: 'Invalid Sandbox id'});
        }

      const files = await fsManager.listDirectory(sandboxId, targetPath);
      res.status(200).json(files);
    } catch (error: any) {
      console.error(`[VFS Error] Failed to list directory: ${error.message}`);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/fs/:sandboxId/read?path=/workspace/index.js
   */
  router.get('/:sandboxId/read', async (req: Request, res: Response) => {
    try {

       
        const { sandboxId }  = req.params;
        const filePath = req.query.path as string;

        // STRICT TYPE GUARDS

        if(!sandboxId || typeof sandboxId !== 'string'){
            return res.status(400).json({error: 'Invalid Sandbox id'});
        }
        if (!filePath || typeof filePath !== 'string') {
            return res.status(400).json({ error: 'Valid file path is required' });
        }

        const content = await fsManager.readFile(sandboxId, filePath);
        res.status(200).json({ content });
        } catch (error: any) {
        console.error(`[VFS Error] Failed to read file: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/fs/:sandboxId/write
   */
  router.post('/:sandboxId/write', async (req: Request, res: Response) => {
    try {
      const { sandboxId } = req.params;
      const { path: filePath, content } = req.body;
    
      if(!sandboxId || typeof sandboxId !== 'string'){
            return res.status(400).json({error: 'Invalid Sandbox id'});
        }

      if (!filePath || typeof filePath !== 'string' || content === undefined) {
        return res.status(400).json({ error: 'Valid file path and content are required' });
      }

      await fsManager.writeFile(sandboxId, filePath, String(content));
      res.status(200).json({ message: 'File written successfully' });
    } catch (error: any) {
      console.error(`[VFS Error] Failed to write file: ${error.message}`);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * DELETE /api/fs/:sandboxId/delete?path=/workspace/old_folder
   */
  router.delete('/:sandboxId/delete', async (req: Request, res: Response) => {
    try {
      const { sandboxId } = req.params;
      const pathToRemove = req.query.path as string;
    
      if(!sandboxId || typeof sandboxId !== 'string'){
            return res.status(400).json({error: 'Invalid Sandbox id'});
        }

      if (!pathToRemove || typeof pathToRemove !== 'string') {
        return res.status(400).json({ error: 'Valid path to delete is required' });
      }

      await fsManager.deletePath(sandboxId, pathToRemove);
      res.status(200).json({ message: 'Path deleted successfully' });
    } catch (error: any) {
      console.error(`[VFS Error] Failed to delete path: ${error.message}`);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}