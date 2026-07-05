// Best-effort brand-icon slug from a package identifier, for looking up
// `logos:<slug>` / `simple-icons:<slug>`. Handles the shapes our registries and
// dependency badges actually produce:
//   express@4.17.1            npm version suffix
//   numpy==1.0.0              pip version suffix
//   @angular/core@16          scoped npm (+ version)
//   org.springframework:core  maven/gradle coordinate (group:artifact)
//   github.com/gin-gonic/gin  go module path
//   https://…/zfetch.tar.gz   zig tarball URL
//
// A miss is safe — PackageIcon falls back to the package manager's own icon — so
// this only needs to nail the common brands, not every possible string.

// Only where the package name and the icon slug genuinely differ. Aliased toward
// the `logos:` (full-color) names since PackageIcon tries that collection first.
const ALIASES: Record<string, string> = {
  node: 'nodejs-icon',
  nodejs: 'nodejs-icon',
  golang: 'go',
  python3: 'python',
};

// Cut a trailing version spec: python operators (==, >=, ~=, …), a caret/tilde
// range, or a non-leading '@' (npm). Leading '@' is a scope, not a version.
const stripVersion = (s: string): string => {
  const op = s.search(/==|>=|<=|~=|!=|[<>~^]/);
  let out = op >= 0 ? s.slice(0, op) : s;
  const at = out.indexOf('@', 1);
  if (at >= 0) out = out.slice(0, at);
  return out.trim();
};

const fromUrl = (raw: string): string | null => {
  try {
    const u = new URL(raw);
    const parts = u.pathname.split('/').filter(Boolean);
    // github.com/<owner>/<repo>/… -> repo; otherwise the last path segment
    const seg = (u.hostname.includes('github.com') ? parts[1] : parts[parts.length - 1]) || u.hostname;
    return seg.replace(/\.(git|tar\.gz|tgz|zip)$/i, '');
  } catch {
    return null;
  }
};

export const packageIconSlug = (raw = ''): string => {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  let s = /^https?:\/\//i.test(trimmed) ? (fromUrl(trimmed) ?? trimmed) : trimmed;
  s = stripVersion(s).toLowerCase();

  if (s.includes(':')) s = s.split(':').pop()!.trim();          // maven group:artifact -> artifact
  if (s.startsWith('@')) s = s.slice(1).split('/')[0];          // @scope/pkg -> scope
  else if (s.includes('/')) s = s.split('/').filter(Boolean).pop()!; // path -> last segment

  return ALIASES[s] || s;
};
