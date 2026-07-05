import { Icon } from '@iconify/react';
import { InstallStepType } from '@cloud-ide/shared/types/env';
import { MANAGERS } from './index';

interface EnvIconProps {
  type: InstallStepType;
  size?: number;
  className?: string;
}

/**
 * Package-manager icon, straight from the manifest.
 * Full-color `logos:` brand icon, inline SVG via @iconify/react (data cached
 * after first load) — no per-render network. Replaces StepIcon + RegistryIcon.
 */
export const EnvIcon = ({ type, size = 20, className = '' }: EnvIconProps) => {
  const { icon, label } = MANAGERS[type];
  return (
    <div style={{ width: size, height: size }} title={label} className={`flex items-center justify-center ${className}`}>
      <Icon icon={icon} width={size} height={size} className="w-full h-full" />
    </div>
  );
};
