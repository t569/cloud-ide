// Subscribes the status bar to the active language's LSP connection state.
// Returns null when no transport is registered for the language (or it doesn't
// report status) so the status bar can simply render nothing.
import { useEffect, useState } from 'react';
import { LanguageServiceRegistry } from '../lsp';
import { LSPStatus } from '../lsp/types';

export function useLspStatus(
  registry: LanguageServiceRegistry,
  languageId: string | null,
): LSPStatus | null {
  const [status, setStatus] = useState<LSPStatus | null>(null);

  useEffect(() => {
    const transport = languageId ? registry.get(languageId) : undefined;
    if (!transport?.getStatus) {
      setStatus(null);
      return;
    }
    setStatus(transport.getStatus());
    return transport.onStatusChange?.(setStatus);
  }, [registry, languageId]);

  return status;
}
