// Boots the editor's non-visual engines for a sandbox and hands the component
// only what it renders with. Owns three lifecycles:
//   - EditorEventBus       (created once, the central nervous system)
//   - VFSController        (routes bus events <-> the virtual file system)
//   - LanguageServiceRegistry (LSP transports from the manifest)
// plus the live file tree it keeps in sync via the VFS_TREE_UPDATED event.
import { useState, useEffect, useMemo } from 'react';
import { FileNode } from '../types/editor';
import { EditorEventBus } from '../core/EditorEventBus';
import { VFSController } from '../core/VFSController';
import { useWorkspace } from '../context/WorkspaceContext';
import { LanguageServiceRegistry, createLanguageTransports } from '../lsp';
import { createLanguageRegistry } from '../languages';

export function useWorkspaceBootstrap(sandboxId: string) {
  const { dispatch } = useWorkspace();
  const [fileTree, setFileTree] = useState<FileNode[]>([]);

  // One bus for the whole workspace instance.
  const eventBus = useMemo(() => new EditorEventBus(), []);

  // Language-service registry built from the manifest. Each transport is a
  // swappable backend (mock, WebSocket, ...) — see lsp/manifest.ts.
  const langRegistry = useMemo(() => {
    const reg = new LanguageServiceRegistry();
    createLanguageTransports(sandboxId).forEach((t) => reg.register(t));
    return reg;
  }, [sandboxId]);

  // Syntax-highlighting registry: how files map to languages + which grammars
  // to install. Detection lives here so the VFS and Monaco agree on language.
  const languages = useMemo(() => createLanguageRegistry(), []);

  // Live LSP document sync: forward each buffer change to the active language's
  // transport, which accumulates the incremental deltas and debounces the POST.
  // The backend lazily didOpens from disk, so only the deltas cross the network.
  useEffect(() => {
    const unsub = eventBus.on('CONTENT_CHANGED', ({ path, newContent, changes }) => {
      langRegistry.get(languages.detect(path))?.notifyChange?.(path, changes ?? [], newContent);
    });
    return unsub;
  }, [eventBus, langRegistry, languages]);

  // Boot the VFS controller. Subscribe to tree updates BEFORE booting so the
  // initial hydration payload isn't missed.
  useEffect(() => {
    const unsubTree = eventBus.on('VFS_TREE_UPDATED', (p) => setFileTree(p.tree));
    const vfs = new VFSController(eventBus, dispatch, sandboxId, languages);
    vfs.initWorkspace();
    return () => {
      unsubTree();
      vfs.destroy();
    };
  }, [eventBus, dispatch, sandboxId, languages]);

  // Tear down transports (close sockets) when the workspace unmounts.
  useEffect(() => () => langRegistry.dispose(), [langRegistry]);

  return { eventBus, fileTree, langRegistry, languages };
}
