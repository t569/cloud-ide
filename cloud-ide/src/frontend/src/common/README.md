# 🎨 File Icon Engine (offline)

Powers the file-explorer icons. Icons are resolved from a filename to an Iconify slug, then
rendered from a **pre-generated offline bundle** — the browser never contacts an icon CDN.

## 🏗️ Architecture

1. **Resolver (`shared/utils/iconResolver.ts`)** — parses a filename into an Iconify slug
   (e.g. `logos:react`), via exact-name → compound-extension → `vscode-icons:file-type-<ext>` fallback.
2. **Registry (`shared/types/constants/iconRegistry.ts`)** — `FILE_NAME_MAP` + `EXTENSION_MAP`,
   mapping specific files/extensions to pre-coloured slugs across ~8 collections.
3. **Bundle (`icons.offline.json`)** — **generated**, git-ignored. Contains ONLY the icons the
   registry references (~160), extracted from the `@iconify-json/*` data packages by
   `scripts/gen-icon-bundle.mjs`. ~0.5 MB raw vs 10+ MB for the full collections.
4. **Loader (`iconifyOffline.ts`)** — `addCollection`s the bundle into Iconify's **API-less**
   build (`@iconify/react/offline`) and exports `bundledIcons` (the set of available slugs).
5. **Component (`FileIcon.tsx`)** — renders the slug; anything not in `bundledIcons`
   (unmapped extension, or a data package not yet installed) falls back to `vscode-icons:default-file`.

> **Why offline?** The old engine fetched every icon from `api.iconify.design` (with
> `api.simplesvg.com` / `api.unisvg.com` as fallbacks). That failed with `ERR_NAME_NOT_RESOLVED`
> on any host without outbound DNS to those CDNs — and inside a deny-default egress sandbox it's
> dropped — while leaking the open file list to a third party. The bundle removes the dependency.

## 🔁 Rebuilding the bundle (required after a fresh clone or a registry edit)

`icons.offline.json` is **not committed**. It is generated:

```bash
# from src/frontend
npm run icons:build
```

This runs automatically before `npm run dev` and `npm run build` (via the `predev`/`prebuild`
hooks), so the normal flow needs nothing extra — but run it by hand after editing the registry,
or on a fresh checkout before a bare `tsc`. It needs the `@iconify-json/*` **devDependencies**
(installed by the root `npm install`); a collection whose package is missing is skipped with a
warning and its icons fall back to `default-file`, so it never breaks the build.

## 🛠️ Adding / changing an icon

Edit `shared/types/constants/iconRegistry.ts`, then `npm run icons:build`.

* **FILE_NAME_MAP** — exact matches: `'tailwind.config.js': { icon: 'file-icons:tailwind', color: '#06B6D4' }`
* **EXTENSION_MAP** — extensions: `'py': { icon: 'vscode-icons:file-type-python' }`
* **`local:` prefix** — a custom SVG under `common/icons/` (`'nr': { icon: 'local:noir' }`), rendered via `<img>`, not Iconify.

Using an icon from a **new** collection? Add its data package first, then rebuild:

```bash
npm install -D @iconify-json/<collection> -w frontend
npm run icons:build
```

### Finding slugs
Search [icones.js.org](https://icones.js.org). Prefer: **devicon** (pre-coloured IDE logos) →
**vscode-icons** (generic file types) → **file-icons** (niche configs, monochrome — pass a `color`) →
**simple-icons** (brand fallbacks).

## 💻 Usage

```tsx
import { FileIcon } from '@frontend/common/FileIcon';
<FileIcon fileName="main.rs" size={16} />
```
