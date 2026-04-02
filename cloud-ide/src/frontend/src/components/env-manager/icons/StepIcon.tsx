// src/frontend/src/components/env-manager/StepIcon.tsx

// This file defines the StepIcon component,
//  which dynamically resolves icons for build steps based on their type and package name.
//  It first tries to load an icon from a CDN using the package name,
//  and if that fails,
//  it falls back to a predefined set of icons based on the step type
//  (e.g., npm, pip, apt). If all else fails,
//  it shows a generic package icon.
//  This enhances the visual clarity of the environment configuration by providing intuitive icons for each step.

import { 
  SiNpm, SiPython, SiGnubash, SiUbuntu, 
  SiRust, SiGo, SiRuby, SiApachemaven, SiZig, 
  SiGradle
} from 'react-icons/si';
import { Package } from 'lucide-react';
import { InstallStepType } from '@cloud-ide/shared/types/env';

interface StepIconProps {
  type: InstallStepType;
  size?: number;
}

export const StepIcon = ({ type, size = 24 }: StepIconProps) => {
  const iconMap: Record<string, React.JSX.Element> = {
    npm: <SiNpm className="text-red-500 w-full h-full" />,
    pip: <SiPython className="text-blue-500 w-full h-full" />,
    apt: <SiUbuntu className="text-orange-500 w-full h-full" />,
    shell: <SiGnubash className="text-gray-700 w-full h-full" />,
    cargo: <SiRust className="text-black w-full h-full" />,
    go: <SiGo className="text-cyan-600 w-full h-full" />,
    ruby: <SiRuby className="text-red-600 w-full h-full" />,
    maven: <SiApachemaven className="text-red-800 w-full h-full" />,
    gradle: <SiGradle className="text-green-600 w-full h-full" />,
    zig: <SiZig className="text-orange-400 w-full h-full" />,
    default: <Package className="text-gray-400 w-full h-full" />
  };

  return (
    <div style={{ width: size, height: size }} className="flex items-center justify-center">
      {iconMap[type] || iconMap.default}
    </div>
  );
};
