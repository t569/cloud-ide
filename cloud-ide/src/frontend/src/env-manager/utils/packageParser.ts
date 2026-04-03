// frontend/src/utils/packageParser.ts

// this file is used to resolve a library name (based on the language) to library name and version number seperately
// for example node@1.2.0 will become {'node','1.2.0'} and sympy==1.2.0 will become {'sympy','1.2.0'}
 
// 1. Define the exact shape of what this function returns
export interface ParsedPackage {
  name: string;
  version: string;
  iconName: string;
}

export const parsePackageString = (rawInput: string = ''): ParsedPackage => {
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
    if (match && match.index !== undefined) {
      const operatorIndex = match.index;
      name = name.substring(0, operatorIndex).trim();
      version = match[2].trim();
      break; 
    }
  }

  let iconName = name.toLowerCase();
  
  if (iconName.startsWith('@') && iconName.includes('/')) {
    iconName = iconName.split('/')[0].replace('@', ''); 
  }

  // 2. The Fix: Tell TS this is a string-to-string dictionary
  const ICON_SLUGS: Record<string, string> = {
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
    'django': 'django',
    'python3': 'python',
  }; 

  // Now TS knows it is perfectly safe to look up a generic string in this object
  iconName = ICON_SLUGS[iconName] || iconName;

  return { 
    name, 
    version: version || 'latest', 
    iconName 
  };
};