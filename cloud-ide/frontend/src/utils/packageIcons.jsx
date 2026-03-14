import React, { useState } from 'react';
import { VscPackage } from 'react-icons/vsc';
import { parsePackageString } from './packageParser';

// 🚨 THE FIX: Changed 'rawString' back to 'name', with a safe default
export const DynamicPackageIcon = ({ name = '', size = 20 }) => {
  const [hasError, setHasError] = useState(false);

  const { iconName } = parsePackageString(name);

  // If there's an error, or the parser returned an empty string, show the default box
  if (hasError || !iconName) {
    return <VscPackage size={size} color="#cccccc" />;
  }

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