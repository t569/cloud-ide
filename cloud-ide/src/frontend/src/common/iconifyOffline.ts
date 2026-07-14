// Offline file icons. The IDE ships ONLY the icons its registry references (see
// scripts/gen-icon-bundle.mjs → icons.offline.json) and renders them with Iconify's
// API-less build (`@iconify/react/offline`), so the file explorer NEVER fetches from
// api.iconify.design / api.simplesvg.com / api.unisvg.com. Those fetches failed with
// ERR_NAME_NOT_RESOLVED on any machine without outbound DNS to those hosts (and inside a
// deny-default egress sandbox they'd be dropped too), and leaked the open file list to a
// third party regardless of whether they succeeded.
//
// FileIcon imports its <Icon> from `@iconify/react/offline` as well, so an icon we did not
// bundle just renders the default-file fallback (bundled) — never a request.
//
// The bundle spans every collection the registry uses (vscode-icons, logos, simple-icons,
// devicon, file-icons, icon-park-*, skill-icons) but only the ~166 icons actually used, so
// it stays tiny. Regenerate after editing the registry:  npm run icons:build
import { addCollection } from '@iconify/react/offline';
import type { IconifyJSON } from '@iconify/types';
import collections from './icons.offline.json';

/** Every icon name (`prefix:name`) actually in the bundle. FileIcon consults it to pick a
 *  deterministic fallback — the API-less <Icon> renders nothing for a name it doesn't hold,
 *  and its `fallback` prop only covers async loads, not a permanently-absent icon. */
export const bundledIcons = new Set<string>();

// Cast through unknown: the JSON's inferred literal shape doesn't structurally overlap
// IconifyJSON (optional fields, index signatures), but it IS one by construction.
for (const collection of collections as unknown as IconifyJSON[]) {
  for (const name of Object.keys(collection.icons ?? {})) bundledIcons.add(`${collection.prefix}:${name}`);
  for (const name of Object.keys(collection.aliases ?? {})) bundledIcons.add(`${collection.prefix}:${name}`);
  addCollection(collection);
}
