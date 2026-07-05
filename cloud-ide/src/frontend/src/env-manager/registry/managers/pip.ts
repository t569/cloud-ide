import { parse as parseToml } from 'smol-toml';
import { PackageManager } from '../types';
import { RegistryError } from '../RegistryError';

const parseRequirements = (text: string): string[] =>
  text.split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split('==')[0].split('>=')[0].trim());

const parsePyproject = (text: string): string[] => {
  const toml: any = parseToml(text);
  const packages: string[] = [];

  // PEP-621 array form
  if (toml.project?.dependencies) {
    toml.project.dependencies.forEach((dep: string) => packages.push(dep.split(/[=><~^]/)[0].trim()));
  }
  // Poetry object form
  if (toml.tool?.poetry?.dependencies) {
    Object.keys(toml.tool.poetry.dependencies).forEach((dep) => { if (dep !== 'python') packages.push(dep); });
  }
  return Array.from(new Set(packages));
};

export const pip: PackageManager = {
  type: 'pip',
  label: 'PyPI',
  icon: 'logos:python',
  acceptExts: '.txt,.toml',

  async search(name, version) {
    const url = version ? `https://pypi.org/pypi/${name}/${version}/json` : `https://pypi.org/pypi/${name}/json`;
    try {
      const res = await fetch(url);
      if (res.status === 404) throw new RegistryError(`Package '${name}' not found on PyPI.`, 'pip', 404);
      if (!res.ok) throw new RegistryError(`PyPI responded with status: ${res.status}`, 'pip', res.status);

      const data = await res.json();
      return [{
        name: data.info.name,
        version: data.info.version,
        description: data.info.summary?.substring(0, 80),
        type: 'pip',
        exactMatch: true,
      }];
    } catch (error) {
      if (error instanceof RegistryError) throw error;
      throw new RegistryError(`Failed to connect to PyPI: ${(error as Error).message}`, 'pip');
    }
  },

  canParse: (file) => file.name.toLowerCase() === 'pyproject.toml' || file.name.endsWith('.txt'),

  async parse(file) {
    const text = await file.text();
    try {
      return file.name.toLowerCase() === 'pyproject.toml' ? parsePyproject(text) : parseRequirements(text);
    } catch (error) {
      console.error('Failed to parse Python dependencies:', error);
      throw new Error('Invalid format in Python dependency file.');
    }
  },
};
