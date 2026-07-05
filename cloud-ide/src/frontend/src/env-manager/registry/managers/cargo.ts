import { parse as parseToml } from 'smol-toml';
import { PackageManager } from '../types';
import { RegistryError } from '../RegistryError';

export const cargo: PackageManager = {
  type: 'cargo',
  label: 'crates.io',
  icon: 'logos:rust',
  acceptExts: '.toml',

  async search(name, version) {
    try {
      if (version) {
        const res = await fetch(`https://crates.io/api/v1/crates/${name}/${version}`);
        if (res.status === 404) throw new RegistryError(`Crate '${name}' version '${version}' not found.`, 'cargo', 404);
        if (!res.ok) throw new RegistryError(`Crates.io responded with status: ${res.status}`, 'cargo', res.status);

        const data = await res.json();
        return [{ name: data.version.crate, version: data.version.num, description: 'Exact version match', type: 'cargo', exactMatch: true }];
      }

      const res = await fetch(`https://crates.io/api/v1/crates?q=${name}&per_page=5`);
      if (!res.ok) throw new RegistryError(`Crates.io search failed with status: ${res.status}`, 'cargo', res.status);

      const data = await res.json();
      if (data.crates.length === 0) throw new RegistryError(`No crates found matching '${name}'`, 'cargo', 404);

      return data.crates.map((c: any) => ({
        name: c.name,
        version: c.max_version,
        description: c.description?.length > 80 ? c.description.substring(0, 80) + '...' : c.description,
        type: 'cargo',
      }));
    } catch (error) {
      if (error instanceof RegistryError) throw error;
      throw new RegistryError(`Network failure connecting to Crates.io: ${(error as Error).message}`, 'cargo');
    }
  },

  canParse: (file) => file.name.toLowerCase() === 'cargo.toml' || file.name.endsWith('.toml'),

  async parse(file) {
    try {
      const toml: any = parseToml(await file.text());
      const deps = Object.keys(toml.dependencies || {});
      const devDeps = Object.keys(toml['dev-dependencies'] || {});
      return Array.from(new Set([...deps, ...devDeps]));
    } catch (error) {
      console.error('Failed to parse Cargo.toml:', error);
      throw new Error('Invalid TOML format in file.');
    }
  },
};
