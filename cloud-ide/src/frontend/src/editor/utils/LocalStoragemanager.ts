// frontend/src/editor/utils/LocalStorageManager.ts
import { IDEGlobalSettings, WorkspaceLayoutState } from '../types/editor';

/** The persisted open-tab set for one sandbox (paths only — bodies live on disk). */
export interface EditorSession {
  openFiles: string[];
  activeFilePath: string | null;
}

/**
 * ============================================================================
 * LOCAL STORAGE MANAGER
 * ============================================================================
 * A pure, type-safe utility for interacting with the browser's storage engine.
 * Features:
 * - Strict Namespacing to prevent key collisions with other apps.
 * - Silent Error Recovery (handles QuotaExceeded and corrupted JSON).
 * - Partial Merging (allows saving just one setting without overwriting others).
 */
export class LocalStorageManager {
  private static readonly PREFIX_GLOBAL = 'cloud-ide:global:';
  private static readonly PREFIX_WORKSPACE = 'cloud-ide:workspace:';
  private static readonly PREFIX_SESSION = 'cloud-ide:session:';

  // --- DEFAULT FALLBACK STATES ---
  
  private static readonly DEFAULT_GLOBAL_SETTINGS: IDEGlobalSettings = {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 14,
    theme: 'dark',
    formatOnSave: false
  };

  private static readonly DEFAULT_WORKSPACE_STATE: WorkspaceLayoutState = {
    sidebarOpen: true,
    activeSidebarPanel: 'explorer',
    sidebarWidth: 250,
    bottomPanelOpen: true,
    bottomPanelHeight: 250
  };

  // ==========================================
  // GLOBAL SETTINGS (Theme, Fonts, etc.)
  // ==========================================

  /**
   * Retrieves global IDE settings. Falls back to defaults if missing or corrupted.
   */
  public static getGlobalSettings(): IDEGlobalSettings {
    try {
      const stored = localStorage.getItem(`${this.PREFIX_GLOBAL}settings`);
      if (!stored) return this.DEFAULT_GLOBAL_SETTINGS;
      
      const parsed = JSON.parse(stored);
      // Merge stored data with defaults to ensure missing keys are populated
      return { ...this.DEFAULT_GLOBAL_SETTINGS, ...parsed };
    } catch (error) {
      console.warn('[StorageManager] Corrupted global settings detected. Resetting to defaults.', error);
      return this.DEFAULT_GLOBAL_SETTINGS;
    }
  }

  /**
   * Saves global IDE settings. Accepts a Partial object so you can update 
   * just one setting (e.g., fontSize) without passing the whole object.
   */
  public static saveGlobalSettings(newSettings: Partial<IDEGlobalSettings>): void {
    try {
      const current = this.getGlobalSettings();
      const updated = { ...current, ...newSettings };
      localStorage.setItem(`${this.PREFIX_GLOBAL}settings`, JSON.stringify(updated));
    } catch (error) {
      console.error('[StorageManager] Failed to save global settings. Storage might be full.', error);
    }
  }

  // ==========================================
  // WORKSPACE STATE (Layout, Panels, Widths)
  // ==========================================

  /**
   * Retrieves layout state for a specific sandbox. 
   * This ensures opening a Python backend project doesn't inherit the 
   * layout of a React frontend project the user was just looking at.
   */
  public static getWorkspaceState(sandboxId: string): WorkspaceLayoutState {
    try {
      const stored = localStorage.getItem(`${this.PREFIX_WORKSPACE}${sandboxId}:layout`);
      if (!stored) return this.DEFAULT_WORKSPACE_STATE;
      
      const parsed = JSON.parse(stored);
      return { ...this.DEFAULT_WORKSPACE_STATE, ...parsed };
    } catch (error) {
      console.warn(`[StorageManager] Corrupted layout for sandbox ${sandboxId}. Resetting.`, error);
      return this.DEFAULT_WORKSPACE_STATE;
    }
  }

  /**
   * Saves the layout state for a specific sandbox.
   */
  public static saveWorkspaceState(sandboxId: string, newState: Partial<WorkspaceLayoutState>): void {
    try {
      const current = this.getWorkspaceState(sandboxId);
      const updated = { ...current, ...newState };
      localStorage.setItem(`${this.PREFIX_WORKSPACE}${sandboxId}:layout`, JSON.stringify(updated));
    } catch (error) {
      console.error(`[StorageManager] Failed to save layout for sandbox ${sandboxId}.`, error);
    }
  }

  // ==========================================
  // EDITOR SESSION (Open tabs — survive a reload)
  // ==========================================
  //
  // Which files were open and which was active, per sandbox. The file BODIES are
  // NOT stored here — the VFS autosaves them to the backend worktree, so on reload
  // we just re-open the same paths and their content streams back from disk. This
  // is what stops a refresh from dropping you onto a blank editor with "no files
  // open" even though nothing was actually lost.

  /** Restore the set of open tabs for a sandbox. Empty when there's no record. */
  public static getSession(sandboxId: string): EditorSession {
    try {
      const stored = localStorage.getItem(`${this.PREFIX_SESSION}${sandboxId}`);
      if (!stored) return { openFiles: [], activeFilePath: null };
      const parsed = JSON.parse(stored);
      return {
        openFiles: Array.isArray(parsed.openFiles) ? parsed.openFiles.filter((p: unknown) => typeof p === 'string') : [],
        activeFilePath: typeof parsed.activeFilePath === 'string' ? parsed.activeFilePath : null,
      };
    } catch (error) {
      console.warn(`[StorageManager] Corrupted session for sandbox ${sandboxId}. Ignoring.`, error);
      return { openFiles: [], activeFilePath: null };
    }
  }

  /** Persist the set of open tabs for a sandbox. */
  public static saveSession(sandboxId: string, session: EditorSession): void {
    try {
      localStorage.setItem(`${this.PREFIX_SESSION}${sandboxId}`, JSON.stringify(session));
    } catch (error) {
      console.error(`[StorageManager] Failed to save session for sandbox ${sandboxId}.`, error);
    }
  }

  // ==========================================
  // UTILITIES
  // ==========================================

  /**
   * Clears ONLY the Cloud IDE data, leaving other website data intact.
   * Useful for a "Reset to Factory Defaults" button in the settings menu.
   */
  public static factoryReset(): void {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('cloud-ide:')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));
      console.log('[StorageManager] Factory reset complete.');
    } catch (error) {
      console.error('[StorageManager] Failed to execute factory reset.', error);
    }
  }
}