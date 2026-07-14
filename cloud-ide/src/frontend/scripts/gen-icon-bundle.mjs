// Generates src/common/icons.offline.json — the ONLY icon data shipped to the browser.
//
// The file explorer resolves icons from ~8 Iconify collections (vscode-icons, logos,
// simple-icons, devicon, file-icons, icon-park-*, skill-icons). Bundling those whole
// would be multiple MB (simple-icons alone is ~3200 icons) to render the ~166 we use, so
// this extracts EXACTLY the referenced icons — plus vscode-icons' default-file/-folder
// fallback — into one small collection-array that iconifyOffline.ts loads with
// addCollection. The Iconify API stays disabled, so nothing is ever fetched.
//
// Run after editing the registry:  npm run icons:build
// Needs the @iconify-json/* data packages installed (devDependencies). A collection whose
// package is absent is SKIPPED with a warning — its icons then fall back to default-file —
// so a partial install never breaks the build.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const registryPath = resolve(here, '../../shared/types/constants/iconRegistry.ts');
const outPath = resolve(here, '../src/common/icons.offline.json');

// Every `'<prefix>:<name>'` literal in the registry. Names are lowercase alnum + hyphens.
const registry = readFileSync(registryPath, 'utf8');
const byPrefix = new Map();
for (const [, prefix, name] of registry.matchAll(/'([a-z][a-z0-9-]*):([a-z0-9][a-z0-9-]*)'/g)) {
  if (prefix === 'local') continue; // local: SVGs are <img>-rendered, not Iconify
  (byPrefix.get(prefix) ?? byPrefix.set(prefix, new Set()).get(prefix)).add(name);
}
// FileIcon's hard-coded fallback — must always be present.
(byPrefix.get('vscode-icons') ?? byPrefix.set('vscode-icons', new Set()).get('vscode-icons'))
  .add('default-file').add('default-folder');

/** Copy only `names` (following one-level alias chains) out of a full IconifyJSON. */
function subset(src, names) {
  const out = { prefix: src.prefix, icons: {}, aliases: {} };
  if (src.width) out.width = src.width;
  if (src.height) out.height = src.height;
  const pull = (name, depth = 0) => {
    if (out.icons[name] || out.aliases[name] || depth > 8) return true;
    if (src.icons?.[name]) { out.icons[name] = src.icons[name]; return true; }
    const alias = src.aliases?.[name];
    if (alias) { out.aliases[name] = alias; pull(alias.parent, depth + 1); return true; }
    return false;
  };
  const missing = [...names].filter((n) => !pull(n));
  if (missing.length) console.warn(`  [warn] ${src.prefix}: ${missing.length} not found: ${missing.join(', ')}`);
  return out;
}

const collections = [];
let iconCount = 0;
for (const [prefix, names] of [...byPrefix].sort()) {
  let data;
  try {
    data = require(`@iconify-json/${prefix}/icons.json`);
  } catch {
    console.warn(`  [skip] @iconify-json/${prefix} not installed — ${names.size} icons will fall back to default-file`);
    continue;
  }
  const s = subset(data, names);
  const n = Object.keys(s.icons).length;
  if (!n && !Object.keys(s.aliases).length) continue;
  collections.push(s);
  iconCount += n;
  console.log(`  ${prefix}: ${n} icons`);
}

writeFileSync(outPath, JSON.stringify(collections));
console.log(`\nWrote ${iconCount} icons across ${collections.length} collections → ${outPath}`);
