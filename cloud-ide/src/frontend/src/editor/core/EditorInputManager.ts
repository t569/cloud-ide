// frontend/src/editor/core/EditorInputManager.ts
import * as monaco from 'monaco-editor';
import { EditorEventBus } from './EditorEventBus';

export class EditorInputManager {
  private editor: monaco.editor.IStandaloneCodeEditor;
  private eventBus: EditorEventBus;
  private currentPath: string;

  constructor(
    editor: monaco.editor.IStandaloneCodeEditor, 
    eventBus: EditorEventBus,
    initialPath: string
  ) {
    this.editor = editor;
    this.eventBus = eventBus;
    this.currentPath = initialPath;

    this.registerShortcuts();
  }

  public updateActivePath(newPath: string) {
    this.currentPath = newPath;
  }

  /**
   * Registers global shortcuts overriding browser defaults.
   */
  private registerShortcuts() {
    // Intercept Ctrl+S / Cmd+S
    this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      this.eventBus.emit('SAVE_REQUESTED', { path: this.currentPath });
    });

    // Intercept Shift+Alt+F (Standard format document shortcut)
    this.editor.addCommand(monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF, () => {
      this.eventBus.emit('COMMAND_FORMAT', { path: this.currentPath });
    });

    // Intercept Ctrl+P (Quick Open / File Search)
    this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP, () => {
      this.eventBus.emit('COMMAND_PALETTE', {});
    });
  }
}