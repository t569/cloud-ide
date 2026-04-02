// src/frontend/src/components/env-manager/icons/PackageIcon.tsx

// This file defines the PackageIcon component,
//  which dynamically resolves icons for packages based on their name and type.
//  It first tries to load an icon from a CDN using the package name,
//  and if that fails, it falls back to a predefined set of icons based on the package type
//  (e.g., npm, pip, apt). If all else fails, it shows a generic package icon.
//  This enhances the visual clarity of the environment configuration by providing intuitive icons for each package.


import React, { useEffect, useState } from 'react';
import { parsePackageString } from '../../../utils/packageParser';
import { StepIcon } from './StepIcon'; // Import the tool icons
import { set } from 'react-hook-form';

interface PackageIconProps {
  name: string;
  type: any; // InstallStepType
  size?: number;
}

export const PackageIcon = ({ name, type, size = 20 }: PackageIconProps) => {
  const [hasError, setHasError] = useState(false);
  const { iconName } = parsePackageString(name);

  useEffect(() => {
    setHasError(false); // Reset error state when name changes
  }, [name]);

  // 1. Try CDN first for the specific library logo
  if (iconName && !hasError) {
    return (
      <div style={{ width: size, height: size }} className="flex items-center justify-center">
        <img
          src={`https://cdn.simpleicons.org/${iconName}`}
          alt={iconName}
          className="w-full h-full object-contain"
          onError={() => setHasError(true)}
        />
      </div>
    );
  }

  console.log(`Package: ${name} | Slug: ${iconName} | Error: ${hasError}`);

  // 2. Fallback: If CDN fails or no name, use the StepIcon for that type
  return <StepIcon type={type} size={size} />;
};
