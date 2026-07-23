// Boots the editor's non-visual engines for a sandbox and hands the component
// only what it renders with. Owns three lifecycles:
//   - EditorEventBus       (created once, the central nervous system)
//   - VFSController        (routes bus events <-> the virtual file system)
//   - LanguageServiceRegistry (LSP transports from the manifest)
// plus the live file tree it keeps in sync via the VFS_TREE_UPDATED event.
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { FileNode } from '../types/editor';
import { EditorEventBus } from '../core/EditorEventBus';
import { VFSController } from '../core/VFSController';
import type { WorkspaceTier } from '../core/tier';
import { useWorkspace } from '../context/WorkspaceContext';
import { LanguageServiceRegistry, createLanguageTransports } from '../lsp';
import { createLanguageRegistry } from '../languages';

export function useWorkspaceBootstrap(sandboxId: string, tier?: WorkspaceTier) {
  const { dispatch } = useWorkspace();
  const [fileTree, setFileTree] = useState<FileNode[]>([]);

  // One bus for the whole workspace instance.
  const eventBus = useMemo(() => new EditorEventBus(), []);

  // Language-service registry. WHICH languages have a server is a property of the
  // sandbox's environment, so the manifest asks the backend instead of hardcoding a
  // list. It starts empty (the editor must render immediately, LSP or not) and is
  // REPLACED once the answer arrives — MonacoEditorWrapper re-installs its providers
  // when the registry identity changes, so a late answer still lights up.
  const [langRegistry, setLangRegistry] = useState(() => new LanguageServiceRegistry());

  useEffect(() => {
    let live = true;
    const registry = new LanguageServiceRegistry();

    createLanguageTransports(sandboxId).then((transports) => {
      if (!live) return transports.forEach((t) => t.dispose?.());
      transports.forEach((t) => registry.register(t));
      setLangRegistry(registry);
    });

    return () => {
      live = false;
      registry.dispose();
    };
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
  // initial hydration payload isn't missed. The ref exposes an awaitable flush
  // (Detach must know the writes landed before it pauses the sandbox).
  const vfsRef = useRef<VFSController | null>(null);
  useEffect(() => {
    let live = true;
    const unsubTree = eventBus.on('VFS_TREE_UPDATED', (p) => setFileTree(p.tree));
    const vfs = new VFSController(eventBus, dispatch, sandboxId, languages, tier);
    vfsRef.current = vfs;

    // The browser tier has to create its directory and repository before the first
    // hydration; the server tier resolves immediately. Awaiting either way keeps one
    // ordering rather than a branch, and `live` guards a unmount during that await.
    (tier?.ensureReady() ?? Promise.resolve())
      .then(() => { if (live) vfs.initWorkspace(); })
      .catch((err) => console.error('[Bootstrap] Storage failed to initialise:', err));

    return () => {
      live = false;
      unsubTree();
      vfsRef.current = null;
      vfs.destroy();
    };
  }, [eventBus, dispatch, sandboxId, languages, tier]);

  const flush = useCallback(() => vfsRef.current?.flush() ?? Promise.resolve(), []);

  // Tear down transports (close sockets) when the workspace unmounts.
  useEffect(() => () => langRegistry.dispose(), [langRegistry]);

  return { eventBus, fileTree, langRegistry, languages, flush };
}
