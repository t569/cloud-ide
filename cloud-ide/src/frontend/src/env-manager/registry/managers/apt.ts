import { PackageManager } from '../types';

export const apt: PackageManager = {
  type: 'apt',
  label: 'APT',
  icon: 'logos:ubuntu',

  // APT has no CORS web API — return an optimistic exact match.
  async search(name, version) {
    return [{
      name,
      version: version || undefined,
      description: `System package. Will execute: apt-get install ${name}`,
      type: 'apt',
      exactMatch: true,
    }];
  },
};
