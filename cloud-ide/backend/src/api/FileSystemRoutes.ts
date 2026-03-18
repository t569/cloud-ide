// src/api/FileSystemRoutes.ts: defines the api endpoint for changes made in the editor to our backend mount

import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ISessionRepository } from '../database/ISessionRepository';


// TODO: 46
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

  /**
   * Recursive utility to map the physical hard drive into a UI tree
   */
  const buildFileTree = async (currentDir: string, baseMountPath: string): Promise<any[]> => {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    // our recursive tree structure
    const tree = [];

    // Sort folders first, then files, alphabetically
    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      // Skip hidden/heavy folders to keep the UI fast
      // TODO: make this more comprehensive
      if (['node_modules', '.git', '__pycache__'].includes(entry.name)) continue;

      const fullPath = path.join(currentDir, entry.name);
      // Create a clean relative path for the frontend (e.g., "/src/index.js")
      const relativePath = fullPath.replace(baseMountPath, '').replace(/\\/g, '/');

      if (entry.isDirectory()) {
        tree.push({
          name: entry.name,
          path: relativePath,
          type: 'folder',
          isOpen: false, // UI state
          children: await buildFileTree(fullPath, baseMountPath) // Recurse!
        });
      } else {
        tree.push({
          name: entry.name,
          path: relativePath,
          type: 'file'
        });
      }
    }
    return tree;
  };

  // ==========================================
  // GET: Fetch the Workspace Directory Tree
  // ==========================================
  router.get('/:sessionId/tree', async (req, res) => {
    try {
      const { sessionId } = req.params;

      const session = await sessionRepo.get(sessionId);
      if (!session) return res.status(404).json({ error: 'Session not found.' });

      // Build the tree starting from the session's root mount path
      const fileTree = await buildFileTree(session.mountPath, session.mountPath);
      
      res.json({ tree: fileTree });

    } catch (err: any) {
      res.status(500).json({ error: `Failed to build directory tree: ${err.message}` });
    }
  });

  
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
  // POST: Create a new empty file
  // ==========================================
  router.post('/:sessionId/file', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { path: filePath } = req.body;

      if (!filePath) return res.status(400).json({ error: 'File path is required.' });

      const session = await sessionRepo.get(sessionId);
      if (!session) return res.status(404).json({ error: 'Session not found.' });

      const secureFilePath = resolveSecurePath(session.mountPath, filePath);

      // 'wx' flag: Open for writing, but fail if the path exists.
      await fs.writeFile(secureFilePath, '', { flag: 'wx' });
      res.status(201).json({ message: 'File created successfully.' });

    } catch (err: any) {
      if (err.code === 'EEXIST') return res.status(409).json({ error: 'File already exists.' });
      res.status(403).json({ error: err.message });
    }
  });

  // ==========================================
  // POST: Create a new directory
  // ==========================================
  router.post('/:sessionId/directory', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { path: dirPath } = req.body;

      if (!dirPath) return res.status(400).json({ error: 'Directory path is required.' });

      const session = await sessionRepo.get(sessionId);
      if (!session) return res.status(404).json({ error: 'Session not found.' });

      const secureDirPath = resolveSecurePath(session.mountPath, dirPath);

      await fs.mkdir(secureDirPath, { recursive: true });
      res.status(201).json({ message: 'Directory created successfully.' });

    } catch (err: any) {
      res.status(403).json({ error: err.message });
    }
  });

  // ==========================================
  // PUT: Rename or Move a file/directory
  // ==========================================
  router.put('/:sessionId/rename', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { oldPath, newPath } = req.body;

      if (!oldPath || !newPath) return res.status(400).json({ error: 'Both oldPath and newPath are required.' });

      const session = await sessionRepo.get(sessionId);
      if (!session) return res.status(404).json({ error: 'Session not found.' });

      // We must secure BOTH the origin and the destination paths
      const secureOldPath = resolveSecurePath(session.mountPath, oldPath);
      const secureNewPath = resolveSecurePath(session.mountPath, newPath);

      await fs.rename(secureOldPath, secureNewPath);
      res.json({ message: 'Renamed successfully.' });

    } catch (err: any) {
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

  // ==========================================
  // DELETE: Remove a file or directory
  // ==========================================
  router.delete('/:sessionId/entity', async (req, res) => {
    try {
      const { sessionId } = req.params;
      // Using query params for DELETE requests is standard practice
      const targetPath = req.query.path as string; 

      if (!targetPath) return res.status(400).json({ error: 'Target path is required.' });

      const session = await sessionRepo.get(sessionId);
      if (!session) return res.status(404).json({ error: 'Session not found.' });

      const secureTargetPath = resolveSecurePath(session.mountPath, targetPath);

      // recursive: true handles non-empty folders. force: true ignores errors if it doesn't exist.
      await fs.rm(secureTargetPath, { recursive: true, force: true });
      res.json({ message: 'Deleted successfully.' });

    } catch (err: any) {
      res.status(403).json({ error: err.message });
    }
  });
 
  return router;
}