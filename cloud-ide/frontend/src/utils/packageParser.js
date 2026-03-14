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
      name = name.substring(0, match.index).trim();
      version = match[2].trim();
      break; 
    }
  }

  let iconName = name.toLowerCase();
  if (iconName.startsWith('@') && iconName.includes('/')) {
    iconName = iconName.split('/')[1];
  }

  return { 
    name: name, 
    version: version || 'latest', 
    iconName: iconName 
  };
};