// shared/languageServers.ts
//
// THE ONE TABLE. A language server is two facts: how to install it into an image,
// and how to run it once there. Both the build side and the runtime side read this
// same table, which is what keeps them from drifting:
//
//   build   — pipeline/middleware/injectors/LspInjector appends `install` as a RUN step.
//   runtime — LspProxy spawns `command` inside the container (docker exec -i).
//
// The KEY MUST BE THE EDITOR'S LANGUAGE ID (what LanguageRegistry.detect() returns
// and the transport sends), or the request never routes to the server.
//
// `install` assumes the base image already has that language's toolchain — `rustup`
// for rust, `go` for go, `pip` for python. That's the image's job, not ours: an env
// asking for a rust server on a bare ubuntu base should fail loudly at build time.

export interface LanguageServerSpec {
  /** Shell command that installs the server into the image (runs as root, own layer). */
  install: string;
  /** argv to run the server over stdio inside the container. */
  command: string[];
}

export const LANGUAGE_SERVERS: Record<string, LanguageServerSpec> = {
  python: {
    install: 'pip install --no-cache-dir "python-lsp-server[all]"',
    command: ['pylsp'], // stdio by default
  },
  typescript: {
    install: 'npm install -g typescript typescript-language-server',
    command: ['typescript-language-server', '--stdio'],
  },
  javascript: {
    install: 'npm install -g typescript typescript-language-server',
    command: ['typescript-language-server', '--stdio'],
  },
  rust: {
    install: 'rustup component add rust-analyzer',
    command: ['rust-analyzer'], // stdio-only, which is exactly what we want
  },
  go: {
    install: 'go install golang.org/x/tools/gopls@latest',
    command: ['gopls'],
  },

  // clangd — one binary, no runtime, and the fastest server in this table. It reads
  // compile_commands.json for exact flags; without one it falls back to heuristics,
  // which is still usable (generate it with `bear -- make` or CMAKE_EXPORT_COMPILE_COMMANDS).
  // apt-based: a non-Debian base image will fail the build, loudly, which is correct.
  c: {
    install:
      'apt-get update && apt-get install -y --no-install-recommends clangd && rm -rf /var/lib/apt/lists/*',
    command: ['clangd', '--background-index'],
  },
  cpp: {
    install:
      'apt-get update && apt-get install -y --no-install-recommends clangd && rm -rf /var/lib/apt/lists/*',
    command: ['clangd', '--background-index'],
  },

  // Shell. The editor's id for .sh/.bash/.zsh is `shell`, not `bash` — the key must be
  // the id LanguageRegistry.detect() returns or the request never routes.
  shell: {
    install: 'npm install -g bash-language-server',
    command: ['bash-language-server', 'start'],
  },
};

// Deliberately NOT here:
//   json / html / css / scss / less — Monaco already ships web workers for these with
//     completion, validation and formatting. A server would be a second, slower copy.
//   java / csharp / ruby — jdtls, OmniSharp and Solargraph are heavyweight (JVM/.NET
//     runtimes, slow indexing). Add one when someone actually needs it, not on spec.

export const SUPPORTED_LANGUAGE_SERVERS = Object.keys(LANGUAGE_SERVERS);

/** Throws on an unknown language id — a typo must fail the build, not silently
 *  leave the editor with no intelligence and no explanation. */
export function languageServerSpec(languageId: string): LanguageServerSpec {
  const spec = LANGUAGE_SERVERS[languageId];
  if (!spec) {
    throw new Error(
      `Unknown language server '${languageId}'. Supported: ${SUPPORTED_LANGUAGE_SERVERS.join(', ')}.`,
    );
  }
  return spec;
}
