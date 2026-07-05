import { PackageManager } from '../types';

export const npm: PackageManager = {
  type: 'npm',
  label: 'npm',
  icon: 'logos:npm-icon',
  acceptExts: '.json',

  async search(name, version) {
    try {
      if (version) {
        const res = await fetch(`https://registry.npmjs.org/${name}/${version}`);
        if (!res.ok) return [];
        const data = await res.json();
        return [{ name: data.name, version: data.version, description: data.description, type: 'npm', exactMatch: true }];
      }

      const res = await fetch(`https://registry.npmjs.org/-/v1/search?text=${name}&size=5`);
      if (!res.ok) return [];
      const data = await res.json();

      return data.objects.map((obj: any) => ({
        name: obj.package.name,
        version: obj.package.version,
        description: obj.package.description,
        type: 'npm',
      }));
    } catch (error) {
      console.error('NPM Registry Error:', error);
      return [];
    }
  },

  canParse: (file) => file.name.endsWith('.json'),

  async parse(file) {
    try {
      const json = JSON.parse(await file.text());
      const deps = Object.keys(json.dependencies || {});
      const devDeps = Object.keys(json.devDependencies || {});
      return Array.from(new Set([...deps, ...devDeps]));
    } catch (error) {
      console.error('Failed to parse package.json:', error);
      throw new Error('Invalid JSON format in file.');
    }
  },
};
