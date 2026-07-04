// frontend/src/editor/core/EditorInputManager.ts
import * as monaco from 'monaco-editor';
import { EditorEventBus } from './EditorEventBus';

export class EditorInputManager {
  private editor: monaco.editor.IStandaloneCodeEditor;
  private eventBus: EditorEventBus;
  private currentPath: string;
  // A live getter (not a snapshot) so toggling the setting takes effect at once.
  private getFormatOnSave: () => boolean;

  constructor(
    editor: monaco.editor.IStandaloneCodeEditor,
    eventBus: EditorEventBus,
    initialPath: string,
    getFormatOnSave: () => boolean = () => false,
  ) {
    this.editor = editor;
    this.eventBus = eventBus;
    this.currentPath = initialPath;
    this.getFormatOnSave = getFormatOnSave;

    this.registerShortcuts();
  }

  public updateActivePath(newPath: string) {
    this.currentPath = newPath;
  }

  /**
   * Registers global shortcuts overriding browser defaults.
   */
  private registerShortcuts() {
    // Intercept Ctrl+S / Cmd+S. Format first (if enabled) so the formatting
    // edits are queued into the VFS before SAVE_REQUESTED triggers the flush.
    this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, async () => {
      if (this.getFormatOnSave()) {
        await this.editor.getAction('editor.action.formatDocument')?.run();
      }
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