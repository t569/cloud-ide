import { PackageManager } from '../types';
import { RegistryError } from '../RegistryError';

export const ruby: PackageManager = {
  type: 'ruby',
  label: 'RubyGems',
  icon: 'logos:ruby',
  acceptExts: 'Gemfile',

  async search(name) {
    try {
      // Route through corsproxy.io — RubyGems has no CORS headers.
      const targetUrl = encodeURIComponent(`https://rubygems.org/api/v1/search.json?query=${name}`);
      const res = await fetch(`https://corsproxy.io/?${targetUrl}`);
      if (!res.ok) throw new RegistryError(`RubyGems API error: ${res.statusText}`, 'ruby', res.status);

      const data = await res.json();
      if (data.length === 0) throw new RegistryError(`No gems found for '${name}'`, 'ruby', 404);

      return data.slice(0, 5).map((gem: any) => ({
        name: gem.name,
        version: gem.version,
        description: gem.info?.substring(0, 80) + '...',
        type: 'ruby',
      }));
    } catch (error) {
      if (error instanceof RegistryError) throw error;
      throw new RegistryError(`Network failure connecting to RubyGems: ${(error as Error).message}`, 'ruby');
    }
  },

  canParse: (file) => file.name.toLowerCase() === 'gemfile',

  async parse(file) {
    const text = await file.text();
    const packages: string[] = [];
    // gem "nokogiri" or gem 'rails', '~> 7.0'
    const gemRegex = /^\s*gem\s+['"]([^'"]+)['"]/gm;
    let match;
    while ((match = gemRegex.exec(text)) !== null) {
      if (match[1]) packages.push(match[1]);
    }
    return Array.from(new Set(packages));
  },
};
