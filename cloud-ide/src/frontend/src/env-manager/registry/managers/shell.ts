import { PackageManager } from '../types';

export const shell: PackageManager = {
  type: 'shell',
  label: 'Shell',
  icon: 'logos:bash-icon',

  // Shell steps use a raw command, not the package array.
  async search() {
    return [];
  },
};
