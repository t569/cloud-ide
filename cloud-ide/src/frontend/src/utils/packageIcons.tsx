// frontend/src/utils/packageIcons.jsx

/* this file is used to resolve icons for packages: system packages and language libraries/packages */

import React, { useState } from 'react';
import { VscPackage, VscTools, VscTerminalCmd } from 'react-icons/vsc';
import { SiPython, SiNodedotjs,
         SiRust, SiUbuntu,
         SiGo, SiZig,
         SiRuby, SiApachemaven, SiGradle, 
         SiGnubash} from 'react-icons/si';
import { parsePackageString } from './packageParser';


// This is the map for each of the languages
const ICON_MAP = {
  apt: <SiUbuntu size={20} color="#E95420" title="Ubuntu" />,
  python: <SiPython size={20} color="#3776ab" title="Python" />,
  node: <SiNodedotjs size={20} color="#339933" title="Node.js" />,
  rust: <SiRust size={20} color="#dea584" title="Rust" />,
  golang: <SiGo size={20} color="#00ADD8" title="Go" />,
  ruby: <SiRuby size={20} color="#CC342D" title="Ruby" />,
  zig: <SiZig size={20} color="#ec915c" title="Zig" />,
  maven: <SiApachemaven size={20} color="#007396" title="Maven" />,
  gradle: <SiGradle size={20} color="#007396" title="Gradle" />
};

export const DynamicPackageIcon = ({ name = '', size = 20, type = 'language', baseImage = '' }) => {
  const [hasError, setHasError] = useState(false);
  const { iconName } = parsePackageString(name);
  const lowerBase = baseImage.toLowerCase();

  // FALLBACK LOGIC:
  // If the CDN throws a 404, or there is no specific icon parsed, we trigger the smart fallbacks
  if (hasError || !iconName) {
    // A. check for shell/build steps first since they won't have a package name to parse
    if(['shell', 'build'].includes(type)) {
      return <SiGnubash size={size} color="#4a4a4a" title="Shell Command" />;
    }

    // B. check the map for language-specific fallbacks (e.g. pip packages show a faded Python logo)
    const entry = Object.entries(ICON_MAP).find(([key, val]) =>
    lowerBase.includes(key) || val.type.includes(type)
  );

  if(entry) {
    const {icon: Icon, color, title } = entry[1].props;
    return <Icon size={size} color={color} title={title} />;
  }

  // C. absolute last resort generic package icon
  return <VscPackage size={size} color="#cccccc" title="Package" />;
  }

  return (
    <img 
      src={`https://cdn.simpleicons.org/${iconName}`} 
      alt={`${iconName} icon`}
      width={size}
      height={size}
      onError={() => setHasError(true)} 
      style={{ display: 'inline-block', verticalAlign: 'middle' }}
    />
  );


}

// NEW: A generic Build Icon for headers, buttons, or overall step indicators
export const BuildIcon = ({ size = 20, color = "#555555", title = "Build" }) => {
  return <VscTools size={size} color={color} title={title} />;
};

// A dedicated component just for the Base Image logo!
export const BaseImageIcon = ({ baseImage = '', size = 20 }) => {
  const lowerBase = baseImage.toLowerCase();
  
  if (lowerBase.includes('python')) return <SiPython size={size} color="#3776ab" title="Python Base" />;
  if (lowerBase.includes('node')) return <SiNodedotjs size={size} color="#339933" title="Node.js Base" />;
  if (lowerBase.includes('rust')) return <SiRust size={size} color="#dea584" title="Rust Base" />;
  if (lowerBase.includes('ubuntu')) return <SiUbuntu size={size} color="#E95420" title="Ubuntu Base" />;
  
  return <VscPackage size={size} color="#cccccc" />;
};
