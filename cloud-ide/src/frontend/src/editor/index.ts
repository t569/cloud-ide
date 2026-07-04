// frontend/src/editor/index.ts
//
// Public surface of the editor module.

// The mountable editor workspace (the real, event-bus-driven one).
export { EditorWorkspace } from './components/EditorWorkspace';

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
  Diagnostic,
} from './lsp';
export { LanguageServiceRegistry, MockLSPTransport, WebSocketLSPTransport } from './lsp';
