// Resolves an icon for a package from its name, best-to-worst:
//   logos:<slug>        full-color brand logo (e.g. logos:tensorflow)
//   simple-icons:<slug> monochrome glyph, for packages not in the logos set
//   <EnvIcon>           the package manager's own icon
// Cached inline SVG via @iconify/react — no per-render network request.

import { Icon } from '@iconify/react';
import { InstallStepType } from '@cloud-ide/shared/types/env';
import { packageIconSlug } from './packageIconSlug';
import { EnvIcon } from '../../registry/EnvIcon';

interface PackageIconProps {
  name: string;
  type: InstallStepType;
  size?: number;
}

export const PackageIcon = ({ name, type, size = 20 }: PackageIconProps) => {
  const iconName = packageIconSlug(name);
  const managerFallback = <EnvIcon type={type} size={size} />;

  if (!iconName) return managerFallback;

  const iconProps = { width: size, height: size, className: 'w-full h-full object-contain' };

  return (
    <div style={{ width: size, height: size }} className="flex items-center justify-center">
      <Icon
        icon={`logos:${iconName}`}
        {...iconProps}
        fallback={
          <Icon icon={`simple-icons:${iconName}`} {...iconProps} fallback={managerFallback} />
        }
      />
    </div>
  );
};
