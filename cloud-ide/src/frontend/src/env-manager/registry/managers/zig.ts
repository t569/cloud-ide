import { PackageManager } from '../types';

export const zig: PackageManager = {
  type: 'zig',
  label: 'Zig',
  icon: 'logos:zig',
  acceptExts: '.zon',

  async search(name, version) {
    const isUrl = name.startsWith('http://') || name.startsWith('https://');

    // Soft validation: non-URL deps are unusual — warn but allow.
    if (!isUrl) {
      return [{ name, description: '⚠️ Zig dependencies are usually URLs to .tar.gz archives.', type: 'zig' }];
    }

    let friendlyName = 'Tarball Archive';
    try {
      const urlObj = new URL(name);
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      if (urlObj.hostname.includes('github.com') && pathParts.length >= 2) {
        friendlyName = pathParts[1]; // github.com/ziglibs/zfetch/... -> "zfetch"
      } else {
        friendlyName = pathParts[pathParts.length - 1] || friendlyName;
      }
    } catch {
      // fall back to default name
    }

    return [{ name, version: version || undefined, description: `Zig Dependency: ${friendlyName}`, type: 'zig', exactMatch: true }];
  },

  canParse: (file) => file.name.toLowerCase() === 'build.zig.zon',

  async parse(file) {
    const text = await file.text();
    const packages: string[] = [];
    // Isolate .dependencies = .{ ... } then pull each .url = "..."
    const depsMatch = text.match(/\.dependencies\s*=\s*\.\{([\s\S]*?)\}/);
    if (depsMatch && depsMatch[1]) {
      const urlRegex = /\.url\s*=\s*"([^"]+)"/g;
      let match;
      while ((match = urlRegex.exec(depsMatch[1])) !== null) {
        if (match[1]) packages.push(match[1]);
      }
    }
    return Array.from(new Set(packages));
  },
};
