// frontend/src/editor/index.ts
//
// Public surface of the editor module.

// The mountable editor workspace (the real, event-bus-driven one).
export { EditorWorkspace } from './components/EditorWorkspace';

// Boot contract + extension seam. A host hands a WorkspaceSession to the editor;
// a plugin contributes menus/activity items via the ContributionRegistry.
export type { WorkspaceSession, IEditorPlugin, IContributionRegistry } from './types/editor';
export { ContributionRegistry } from './core/ContributionRegistry';

// Language-service extension points — implement ILanguageServerTransport and
// register it in lsp/manifest.ts to add a backend. See ./README.md.
export type {
  ILanguageServerTransport,
  CompletionItem,
  CompletionParams,
  HoverParams,
  Hover,
  DefinitionParams,
  Location,
  Range,
  TextEdit,
  FormattingParams,
  SignatureHelp,
  SignatureHelpParams,
  RenameParams,
  WorkspaceEdit,
  Diagnostic,
} from './lsp';
export { LanguageServiceRegistry, MockLSPTransport, WebSocketLSPTransport } from './lsp';
