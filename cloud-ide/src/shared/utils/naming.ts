// shared/utils/naming.ts
//
// Single source of truth for environment naming. A user-supplied id must become
// a Docker-safe slug, and the save path + build path must agree on it — otherwise
// a saved env builds to a tag Docker rejects with "invalid reference format".
//
// Docker reference grammar for a name component:
//   [a-z0-9]+([._-][a-z0-9]+)*
// i.e. lowercase, must start/end alphanumeric, no repeated/leading/trailing
// separators. We normalise every separator to '-' for simplicity.

export function toDockerSafeId(raw: string | undefined | null): string {
  const slug = (raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // any run of invalid chars -> single '-'
    .replace(/^-+|-+$/g, '');    // trim leading/trailing '-'
  return slug || `env-${Date.now()}`;
}

// The canonical image tag for an environment. Re-slugs defensively so the output
// is valid even if called with an unsanitised id (idempotent on a safe id).
export function toImageName(id: string): string {
  return `cloud-ide-${toDockerSafeId(id)}:latest`;
}
