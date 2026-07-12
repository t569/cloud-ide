// frontend/src/editor/lsp/manifest.ts
//
// WHICH LANGUAGES GET A SERVER — asked, not hardcoded.
//
// The sandbox's environment declares its language servers (EnvironmentConfig
// .languageServers); the pipeline bakes them into the image and the backend spawns
// them in-container. So the editor asks the backend what THIS sandbox actually has,
// rather than keeping a hand-maintained list here that silently drifts from the images.
//
// Adding a language server to an environment therefore needs no frontend change.

import { ILanguageServerTransport } from './types';
import { HttpLSPTransport } from './transports/HttpLSPTransport';
import { apiClient } from '../../lib/apiClient';
// import { MockLSPTransport } from './transports/MockLSPTransport';

/**
 * The languages this sandbox has a server for: its environment's, plus any global
 * LSP_SERVERS. Failure is a degradation, not an error — no transports just means
 * Monaco highlighting carries the editor, exactly as when nothing is configured.
 */
export async function createLanguageTransports(
  sandboxId: string,
): Promise<ILanguageServerTransport[]> {
  try {
    const { languages } = await apiClient.get<{ languages: string[] }>(
      `/lsp/${encodeURIComponent(sandboxId)}/languages`,
    );
    // Online LSP over debounced HTTP + SSE; the backend proxy owns the transport to the
    // server and routes by :sandboxId/:languageId.
    return languages.map((lang) => new HttpLSPTransport(lang, sandboxId));
  } catch {
    return [];
  }
  // For backend-less local dev with fake intelligence, return:
  //   [new MockLSPTransport('python')];
}
