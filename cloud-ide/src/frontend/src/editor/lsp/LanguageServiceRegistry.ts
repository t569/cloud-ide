// frontend/src/editor/lsp/LanguageServiceRegistry.ts
//
// Holds the active language transports (one per languageId) and installs their
// monaco bridges on editor mount. This is the composition point: it knows about
// the port and the bridge, but nothing about any specific backend.

import * as monaco from 'monaco-editor';
import { ILanguageServerTransport } from './types';
import { MonacoLanguageBridge } from './MonacoLanguageBridge';

export class LanguageServiceRegistry {
  private transports = new Map<string, ILanguageServerTransport>();

  /** Register a transport and eagerly kick off its connection (if any). */
  register(transport: ILanguageServerTransport): void {
    this.transports.set(transport.languageId, transport);
    transport.connect?.().catch(err =>
      console.warn(`[LSP] ${transport.languageId} failed to connect:`, err),
    );
  }

  get(languageId: string): ILanguageServerTransport | undefined {
    return this.transports.get(languageId);
  }

  /**
   * Install monaco providers for every registered transport, returning the handles.
   *
   * Called on editor mount AND whenever the registry is replaced — which languages
   * exist is fetched per sandbox, so the answer can land after Monaco has mounted.
   * The caller disposes the previous handles before re-installing.
   */
  install(m: typeof monaco): monaco.IDisposable[] {
    const disposables: monaco.IDisposable[] = [];
    for (const transport of this.transports.values()) {
      disposables.push(...new MonacoLanguageBridge(transport).install(m));
    }
    return disposables;
  }

  /** Tear down all transports (e.g. close sockets) when the workspace unmounts. */
  dispose(): void {
    for (const transport of this.transports.values()) transport.dispose?.();
    this.transports.clear();
  }
}
