// frontend/src/components/common/FileIcon.tsx
import React from 'react';
// API-less build: never fetches from Iconify's servers. Icons come from the bundle
// registered in common/iconifyOffline.ts; a name not in the bundle renders default-file.
import { Icon } from '@iconify/react/offline';
import { bundledIcons } from './iconifyOffline';
import { resolveIconDefinition } from '@cloud-ide/shared/utils/iconResolver';

const DEFAULT_FILE_ICON = 'vscode-icons:default-file';

interface FileIconProps {
  fileName: string;
  size?: number;
  className?: string;
}

export const FileIcon = ({ fileName, size = 16, className = "" }: FileIconProps) => {
  const { icon, color } = resolveIconDefinition(fileName);

  // 1. Custom local SVGs (e.g. 'local:noir') — <img>-rendered, not via Iconify.
  if (icon?.startsWith('local:')) {
    const localName = icon.split(':')[1];
    return (
      <img
        src={`src/common/icons/${localName}.svg`}
        style={{ width: size, height: size }}
        className={`select-none flex-shrink-0 ${className}`}
        alt={`${localName} icon`}
      />
    );
  }

  // 2. Everything else via Iconify. Fall back to default-file for anything not in the
  //    offline bundle (unmapped extension, or an icon whose data package isn't installed
  //    yet) — the API-less <Icon> would otherwise render blank.
  const shown = icon && bundledIcons.has(icon) ? icon : DEFAULT_FILE_ICON;
  return (
    <Icon
      icon={shown}
      width={size}
      height={size}
      style={{ color: shown === icon ? color : undefined }} // registry color only for the real icon
      className={`flex-shrink-0 ${className}`}
    />
  );
};