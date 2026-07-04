// frontend/src/editor/hooks/useWorkspaceEditor.ts

/* this file handles all the heavy lifting of our editor state management and interactions with the VFS API.
    By abstracting this logic into a custom hook, we can keep our WorkspaceEditor component clean and focused on rendering,
    while this hook manages the editor's lifecycle, state, and side effects related to file saving and dirty state tracking.
*/
import { useState, useRef, useEffect, useCallback } from 'react';
import type { OnMount, OnChange } from '@monaco-editor/react';
import { VirtualFileSystem } from '../../api/vfs';

const AUTOSAVE_DEBOUNCE_MS = 1000;

/** The file object the editor operates on — freshly loaded or being edited. */
export interface WorkspaceFile {
  name: string;
  path: string;
  content: string;
  isDirty: boolean;
}

type FileStateChange = (path: string, updates: Partial<WorkspaceFile>) => void;

export const useWorkspaceEditor = (
  sessionId: string,
  file: WorkspaceFile | null,
  onFileStateChange?: FileStateChange,
) => {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // Reset state when file changes
  useEffect(() => {
    setIsDirty(false);
    clearTimeout(autosaveTimer.current);
  }, [file?.path]);

  // Cancel any pending autosave on unmount
  useEffect(() => () => clearTimeout(autosaveTimer.current), []);

  const saveFile = useCallback(async () => {
    if (!file || !sessionId || !editorRef.current) return;

    clearTimeout(autosaveTimer.current);
    const content = editorRef.current.getValue();
    try {
      setIsSaving(true);
      await VirtualFileSystem.saveFile(sessionId, file.path, content);
      setIsDirty(false);
      onFileStateChange?.(file.path, { isDirty: false });
    } catch (err) {
      console.error("[VFS Error]", err);
    } finally {
      setIsSaving(false);
    }
  }, [file, sessionId, onFileStateChange]);

  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    // Add Save Shortcut
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, saveFile);
  };

  const onChange: OnChange = () => {
    if (!file) return;
    if (!isDirty) {
      setIsDirty(true);
      onFileStateChange?.(file.path, { isDirty: true });
    }

    // Debounced autosave: persist to the VFS once typing pauses
    clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(saveFile, AUTOSAVE_DEBOUNCE_MS);
  };

  return { isSaving, isDirty, onMount, onChange, saveFile };
};
