# 🎨 Dynamic Icon Resolution Engine

This module powers the high-performance, zero-bloat file icon system for the Cloud IDE. It uses a cascading resolution strategy combined with the Iconify dynamic loader to support thousands of programming languages and frameworks without increasing JavaScript bundle size.

## 🏗️ Architecture

1. **Resolver (`iconResolver.ts`)**: Parses filenames into Iconify slugs (e.g., `devicon:python`).
2. **Registry (`iconRegistry.ts`)**: Maps specific files and extensions to pre-colored SVG slugs.
3. **Component (`FileIcon.tsx`)**: React component that dynamically fetches and caches the SVG via Iconify.

---

## 💻 Usage

Import the `FileIcon` component and pass the full filename to render it anywhere in the UI:

```tsx
import { FileIcon } from '@/components/common/FileIcon';

// Renders the official Rust logo
<FileIcon fileName="main.rs" size={16} />

// Renders the NPM logo, overriding standard JSON
<FileIcon fileName="package.json" size={24} />

// Renders a custom ZKP local SVG
<FileIcon fileName="circuit.nr" size={16} />

```

### 🛠️ Updating the Registry
If an icon is missing, add it to `shared/src/constants/iconRegistry.ts`:

*   **FILE_NAME_MAP**: For exact matches (e.g., `tailwind.config.js`, `dockerfile`).

```tsx
// Example: We want Tailwind configs to use the Tailwind logo, not the JS logo
'tailwind.config.js': { icon: 'file-icons:tailwind', color: '#06B6D4' },
'dockerfile': { icon: 'vscode-icons:file-type-docker' },

```
*   **EXTENSION_MAP**: For standard file extensions (e.g., `py`, `go`, `nr`).

```tsx
// Example: Standard Python
'py': { icon: 'vscode-icons:file-type-python' },

// Example: Specialized Noir circuits (loading from local frontend/public/icons)
'nr': { icon: 'local:noir' },
```

### Finding Icon Slugs
Search the [Iconify Database](https://iconify.design). When choosing a set, prefer this order:

1.  **devicon**: Native, pre-colored logos designed for IDEs (Best).
2.  **vscode-icons**: Best for generic file types.
3.  **file-icons**: Best for niche configs (monochrome, so provide a color hex).
4.  **simple-icons**: Best for brand fallbacks.

### ⚡ Features & Performance
*   **Zero Bundle Bloat**: Adding 500 new languages adds ~2KB of text to the bundle, rather than 50MB of SVG paths.
*   **Aggressive Caching**: Once fetched, icons are cached instantly in the browser's localStorage and will not trigger future network requests.
*   **Bulletproof Fallback**: Unknown file extensions automatically attempt to fetch generic VS Code icons, safely falling back to a default document icon if all else fails.
*   **Local Overrides**: The `local:` prefix allows us to bypass the CDN entirely for proprietary or custom extensions.

