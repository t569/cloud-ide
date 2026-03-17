// src/api/FileSystemRoutes.ts: defines the api endpoint for changes made in the editor to our backend mount

import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ISessionRepository } from '../database/ISessionRepository';

export function createFileSystemRouter(sessionRepo: ISessionRepository) {
  const router = Router();

  /**
   * SECURITY GUARD: The Sandbox Enforcer
   * Prevents malicious requests like: filePath = "../../../etc/passwd"
   */
  const resolveSecurePath = (baseMountPath: string, requestedPath: string): string => {
    // 1. Combine the base path and requested path
    const targetPath = path.normalize(path.join(baseMountPath, requestedPath));
    const safeBasePath = path.normalize(baseMountPath);

    // 2. Mathematically verify the target path is still INSIDE the base folder
    if (!targetPath.startsWith(safeBasePath)) {
      throw new Error('Security Violation: Path Traversal Attempt Detected.');
    }

    return targetPath;
  };

  // ==========================================
  // GET: Fetch file content for the Monaco Editor
  // ==========================================
  router.get('/:sessionId/file', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const filePath = req.query.path as string;

      if (!filePath) return res.status(400).json({ error: 'Missing file path query parameter.' });

      // 1. Verify the session exists in the database
      const session = await sessionRepo.get(sessionId);
      if (!session) return res.status(404).json({ error: 'Session not found.' });

      // 2. Securely resolve the path
      const secureFilePath = resolveSecurePath(session.mountPath, filePath);

      // 3. Read the file from the host's physical hard drive
      const content = await fs.readFile(secureFilePath, 'utf-8');
      
      res.json({ content });

    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return res.status(404).json({ error: 'File not found on disk.' });
      }
      res.status(403).json({ error: err.message });
    }
  });

  // ==========================================
  // PUT: Save file content from the Monaco Editor
  // ==========================================
  router.put('/:sessionId/save', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { path: filePath, content } = req.body;

      if (!filePath || typeof content !== 'string') {
        return res.status(400).json({ error: 'Invalid payload. Requires path and content.' });
      }

      // 1. Lookup the physical mount path for this session
      const session = await sessionRepo.get(sessionId);
      if (!session) return res.status(404).json({ error: 'Session not found.' });

      // 2. Securely resolve the path
      const secureFilePath = resolveSecurePath(session.mountPath, filePath);

      // 3. Write the raw string to the hard drive
      await fs.writeFile(secureFilePath, content, 'utf-8');

      // The beautiful part: As soon as fs.writeFile finishes, 
      // your WorkspaceManager's chokidar daemon will instantly detect it!

      res.json({ message: 'File saved successfully.' });

    } catch (err: any) {
      res.status(403).json({ error: err.message });
    }
  });

  return router;
}