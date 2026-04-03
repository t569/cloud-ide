// frontend/src/components/common/FileIcon.tsx
import React from 'react';
import { Icon } from '@iconify/react';
import { resolveIconDefinition } from '@cloud-ide/shared/utils/iconResolver';

interface FileIconProps {
  fileName: string;
  size?: number;
  className?: string;
}

export const FileIcon = ({ fileName, size = 16, className = "" }: FileIconProps) => {
  // THE FIX: We are extracting 'icon' and 'color' from the returned object
  const { icon, color } = resolveIconDefinition(fileName);

  // Safety check just in case something completely invalid gets passed
  if (!icon) {
    return <Icon icon="vscode-icons:default-file" width={size} height={size} className={className} />;
  }

  // 1. Handle Custom Local SVGs (e.g., 'local:noir')
  if (icon.startsWith('local:')) {
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

  // 2. Handle Everything Else via Iconify (Now with color injection!)
  return (
    <Icon
      icon={icon}
      width={size}
      height={size}
      style={{ color: color }} // Applies the hex code if provided in the registry
      className={`flex-shrink-0 ${className}`}
      fallback={
        <Icon 
          icon="vscode-icons:default-file" 
          width={size} 
          height={size} 
          className={`flex-shrink-0 ${className}`} 
        />
      }
    />
  );
};