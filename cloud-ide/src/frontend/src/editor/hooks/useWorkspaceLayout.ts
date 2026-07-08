// Owns the workspace layout (sidebar/bottom-panel open state + sizes) and its
// per-sandbox persistence. Split out of EditorWorkspace so the component stays a
// pure layout shell. Persistence is keyed by sandboxId via LocalStorageManager.
import { useState, useEffect } from 'react';
import { WorkspaceLayoutState } from '../types/editor';
import { LocalStorageManager } from '../utils/LocalStoragemanager';

export function useWorkspaceLayout(sandboxId: string) {
  const [layout, setLayout] = useState<WorkspaceLayoutState>(() =>
    LocalStorageManager.getWorkspaceState(sandboxId),
  );

  // Persist on every change. LocalStorageManager already swallows quota/serialize
  // errors, so this stays fire-and-forget.
  useEffect(() => {
    LocalStorageManager.saveWorkspaceState(sandboxId, layout);
  }, [layout, sandboxId]);

  const toggleSidebar = (panel: string) =>
    setLayout((prev) =>
      prev.activeSidebarPanel === panel && prev.sidebarOpen
        ? { ...prev, sidebarOpen: false }
        : { ...prev, sidebarOpen: true, activeSidebarPanel: panel },
    );

  const setSidebarWidth = (sidebarWidth: number) =>
    setLayout((prev) => ({ ...prev, sidebarWidth }));

  const setBottomPanelHeight = (bottomPanelHeight: number) =>
    setLayout((prev) => ({ ...prev, bottomPanelHeight }));

  return { layout, toggleSidebar, setSidebarWidth, setBottomPanelHeight };
}
