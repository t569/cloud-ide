// Resolves an icon for a Docker base image from its name (e.g. "python:3.11-slim").
// Known bases get a themed brand icon; anything else tries the cleaned name as a
// simple-icons slug and falls back to the Docker whale. Cached inline SVG via
// @iconify/react — no per-render network request.

import { Icon } from '@iconify/react';

interface BaseImageIconProps {
  imageName: string;
  size?: number;
}

// cleaned image name -> { simple-icons slug, brand color }
const BASE_MAP: Record<string, { slug: string; color: string }> = {
  ubuntu: { slug: 'ubuntu', color: '#E95420' },
  debian: { slug: 'debian', color: '#A81D33' },
  alpine: { slug: 'alpinelinux', color: '#0D597F' },
  python: { slug: 'python', color: '#3776AB' },
  node: { slug: 'nodedotjs', color: '#339933' },
  rust: { slug: 'rust', color: '#DEA584' },
  golang: { slug: 'go', color: '#00ADD8' },
  ruby: { slug: 'ruby', color: '#CC342D' },
  java: { slug: 'openjdk', color: '#007396' },
  rhel: { slug: 'redhat', color: '#EE0000' },
  fedora: { slug: 'fedora', color: '#294172' },
};

export const BaseImageIcon = ({ imageName = '', size = 24 }: BaseImageIconProps) => {
  // Strip tag (:latest) and namespace (library/) -> final image name
  const cleanName = imageName.split(':')[0].split('/').pop()?.toLowerCase() || '';
  const matched = BASE_MAP[cleanName];

  const dockerFallback = <Icon icon="logos:docker-icon" width={size} height={size} className="w-full h-full" />;

  if (!cleanName) {
    return <div style={{ width: size, height: size }} className="flex items-center justify-center">{dockerFallback}</div>;
  }

  return (
    <div style={{ width: size, height: size }} title={`Base: ${imageName}`} className="flex items-center justify-center p-0.5">
      <Icon
        icon={`simple-icons:${matched?.slug ?? cleanName}`}
        width={size}
        height={size}
        style={{ color: matched?.color }}
        className="w-full h-full object-contain"
        fallback={dockerFallback}
      />
    </div>
  );
};
