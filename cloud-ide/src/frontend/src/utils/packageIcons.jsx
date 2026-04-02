// frontend/src/utils/packageIcons.jsx

/* this file is used to resolve icons for packages: system packages and language libraries/packages */

import React, { useState } from 'react';
import { VscPackage } from 'react-icons/vsc';
import { SiPython, SiNodedotjs, SiRust, SiUbuntu } from 'react-icons/si';
import { parsePackageString } from './packageParser';

// NEW: A dedicated component just for the Base Image logo!
export const BaseImageIcon = ({ baseImage = '', size = 20 }) => {
  const lowerBase = baseImage.toLowerCase();
  
  if (lowerBase.includes('python')) return <SiPython size={size} color="#3776ab" title="Python Base" />;
  if (lowerBase.includes('node')) return <SiNodedotjs size={size} color="#339933" title="Node.js Base" />;
  if (lowerBase.includes('rust')) return <SiRust size={size} color="#dea584" title="Rust Base" />;
  if (lowerBase.includes('ubuntu')) return <SiUbuntu size={size} color="#E95420" title="Ubuntu Base" />;
  
  return <VscPackage size={size} color="#cccccc" />;
};

// UPDATED: Now accepts 'type' and 'baseImage' to calculate the perfect fallback
export const DynamicPackageIcon = ({ name = '', size = 20, type = 'language', baseImage = '' }) => {
  const [hasError, setHasError] = useState(false);
  const { iconName } = parsePackageString(name);

  // If the CDN throws a 404, we trigger the smart fallbacks
  if (hasError || !iconName) {
    
    // 1. If it's an apt-get package, show the Ubuntu logo
    if (type === 'system') {
      return <SiUbuntu size={size} color="#E95420" title="System Tool" />;
    }
    
    // 2. If it's a language library, show a slightly faded version of the base language logo
    const lowerBase = baseImage.toLowerCase();
    if (lowerBase.includes('python')) return <SiPython size={size} color="#777777" title="Python Package" />;
    if (lowerBase.includes('node')) return <SiNodedotjs size={size} color="#777777" title="NPM Package" />;
    if (lowerBase.includes('rust')) return <SiRust size={size} color="#777777" title="Cargo Package" />;
    
    // 3. Absolute last resort
    return <VscPackage size={size} color="#cccccc" />;
  }

  // Otherwise, render the official brand logo from the CDN
  return (
    <img 
      src={`https://cdn.simpleicons.org/${iconName}`} 
      alt={`${iconName} icon`}
      width={size}
      height={size}
      onError={() => setHasError(true)} 
      style={{ display: 'inline-block' }}
    />
  );
};