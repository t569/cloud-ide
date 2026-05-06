// frontend/src/editor/plugins/PythonLSPConnector.ts
import * as monaco from 'monaco-editor';
import { ILanguageExtension } from '../core/EditorRegistry';
import { EditorEventBus } from '../core/EditorEventBus';

export class PythonLSPConnector implements ILanguageExtension {
  languageId = 'python';
  name = 'PythonLSPConnector';

  public install(eventBus: EditorEventBus): monaco.IDisposable[] {
    const disposables: monaco.IDisposable[] = [];

    // --- UTILITY 1: AUTOCOMPLETION ---
    const completionProvider = monaco.languages.registerCompletionItemProvider(this.languageId, {
      triggerCharacters: ['.'],
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position);
        
        // Throw the request to your backend over the EventBus
        eventBus.emit('COMPLETION_REQUESTED', {
          path: model.uri.path,
          language: this.languageId,
          position: { lineNumber: position.lineNumber, column: position.column },
          word: word.word
        });

        // Resolve with LSP data (mocked here for the visual example)
        return {
          suggestions: [
            {
              label: 'author',
              kind: monaco.languages.CompletionItemKind.Property,
              insertText: 'author',
              detail: 'User',
              range: this.getRange(word, position)
            }
          ]
        };
      }
    });
    disposables.push(completionProvider);

    // --- UTILITY 2: HOVER DOCUMENTATION (Example of adding more utilities) ---
    const hoverProvider = monaco.languages.registerHoverProvider(this.languageId, {
      provideHover: (model, position) => {
        // TODO: make this better by emitting an event to ask the LSP for hover docs based on the symbol under the cursor!
        // You could emit an event here to ask the LSP for docs!
        return {
          contents: [
            { value: '**Python LSP**' },
            { value: 'Fetching docs from backend...' }
          ]
        };
      }
    });
    disposables.push(hoverProvider);

    // Return all disposables so the registry can clean them up later
    return disposables;
  }

  private getRange(word: monaco.editor.IWordAtPosition, position: monaco.Position) {
    return {
      startLineNumber: position.lineNumber,
      endLineNumber: position.lineNumber,
      startColumn: word.startColumn,
      endColumn: word.endColumn,
    };
  }
}