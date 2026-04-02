// frontend/src/utils/packageParser.js

// this file is used to resolve a library name (based on the language) to library name and version number seperately
// for example node@1.2.0 will become {'node','1.2.0'} and sympy==1.2.0 will become {'sympy','1.2.0'}
 
export const parsePackageString = (rawInput = '') => {
  // 🚨 BULLETPROOF FIX: If undefined or null is passed, exit safely
  if (!rawInput) {
    return { name: '', version: 'latest', iconName: '' };
  }

  let name = rawInput.trim();
  let version = '';

  const rules = [
    { regex: /(==|>=|<=|~=|>|<)(.*)/ }, // Python
    { regex: /(?!^)(@)(.*)/ },          // Node/Go/Rust
    { regex: /(:|\^|~>)(.*)/ }          // Ruby/PHP/Java
  ];

  for (const rule of rules) {
    const match = name.match(rule.regex);
    if (match) {
      // name = string before the operator
      const operatorIndex = match.index;
      name = name.substring(0, operatorIndex).trim();
      version = match[2].trim();
      break; 
    }
  }


  // handles scoped packages like @babel/core or @angular/core, we want the icon to be core not babel or angular
  let iconName = name.toLowerCase();
  // Usually, the 'scope' (babel) is the brand we want the icon for.
  if (iconName.startsWith('@') && iconName.includes('/')) {
    iconName = iconName.split('/')[0].replace('@', ''); 
    // result: 'babel'
  }

  // common icon slugs for CDN that don't match the package name exactly
  const ICON_SLUGS = {
    'node': 'nodedotjs',
    'nodejs': 'nodedotjs',
    'nextjs': 'nextdotjs',
    'c++': 'cplusplus',
    'cpp': 'cplusplus',
    'c#': 'csharp',
    'cs': 'csharp',
    'golang': 'go',
    'tailwind': 'tailwindcss',
    'react': 'react',
    'django': 'django'
  }; 
 

  // Apply mapping
  iconName = ICON_SLUGS[iconName] || iconName;

  return { 
    name: name, 
    version: version || 'latest', 
    iconName: iconName 
  };
};