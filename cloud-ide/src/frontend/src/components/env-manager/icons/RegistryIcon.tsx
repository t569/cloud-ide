// src/components/env-manager/icons/RegistryIcon.tsx
import React from 'react';
import { 
  SiNpm, SiPypi, SiRust, SiUbuntu, 
  SiGo, SiRubygems, SiApachemaven, SiZig 
} from 'react-icons/si';
import { VscTerminalCmd } from 'react-icons/vsc';
import { InstallStepType } from '@cloud-ide/shared/types/env';

interface RegistryIconProps {
  type: InstallStepType;
  size?: number;
}

export const RegistryIcon = ({ type, size = 18 }: RegistryIconProps) => {
  const registryMap: Record<InstallStepType, React.JSX.Element> = {
    npm: <SiNpm color="#CB3837" title="NPM Registry" />,
    pip: <SiPypi color="#3775A9" title="Python Package Index" />,
    cargo: <SiRust color="#000000" title="Crates.io" />, // Cargo/Rust
    apt: <SiUbuntu color="#E95420" title="APT Package Manager" />,
    go: <SiGo color="#00ADD8" title="Go Modules" />,
    ruby: <SiRubygems color="#E9573F" title="RubyGems" />,
    maven: <SiApachemaven color="#C71A36" title="Maven Central" />,
    zig: <SiZig color="#F7A41D" title="Zig Build System" />,
    shell: <VscTerminalCmd color="#cccccc" title="Custom Shell Command" />
  };

  return (
    <div style={{ width: size, height: size, color: 'inherit' }} className="flex items-center justify-center">
      {/* Clone the element to apply w-full h-full safely */}
      {React.cloneElement(registryMap[type], { className: 'w-full h-full object-contain' })}
    </div>
  );
};