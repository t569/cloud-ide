// src/components/env-manager/icons/BaseImageIcon.tsx

// This file defines the BaseImageIcon component,
//  which dynamically resolves icons for base images based on their name.
//  It first tries to load an icon from a CDN using the cleaned image name,
//  and if that fails, it falls back to a predefined set of icons based on common base images
//  (e.g., ubuntu, alpine, python). If all else fails, it shows a generic Docker icon.
//  This enhances the visual clarity of the environment configuration by providing intuitive icons for each base image.

import React, { useState } from 'react';
import { 
  SiDocker, SiUbuntu, SiDebian, SiAlpinelinux, 
  SiPython, SiNodedotjs, SiRust, SiGo, SiRuby, 
  SiOpenjdk, SiRedhat, SiFedora 
} from 'react-icons/si';

interface BaseImageIconProps {
  imageName: string; // e.g., "python:3.11-slim" or "library/ubuntu"
  size?: number;
}

export const BaseImageIcon = ({ imageName = '', size = 24 }: BaseImageIconProps) => {
  const [hasError, setHasError] = useState(false);

  // 1. Clean the image name: strip tags (:latest) and paths (library/)
  const cleanName = imageName
    .split(':')[0]         // remove tag
    .split('/')            // handle namespaces
    .pop()                 // get the final part
    ?.toLowerCase() || '';

  // 2. Map common base images to official Brand Icons & Colors
  const baseMap: Record<string, { icon: any, color: string, slug: string }> = {
    ubuntu: { icon: SiUbuntu, color: "#E95420", slug: "ubuntu" },
    debian: { icon: SiDebian, color: "#A81D33", slug: "debian" },
    alpine: { icon: SiAlpinelinux, color: "#0D597F", slug: "alpinelinux" },
    python: { icon: SiPython, color: "#3776AB", slug: "python" },
    node: { icon: SiNodedotjs, color: "#339933", slug: "nodedotjs" },
    rust: { icon: SiRust, color: "#000000", slug: "rust" },
    golang: { icon: SiGo, color: "#00ADD8", slug: "go" },
    ruby: { icon: SiRuby, color: "#CC342D", slug: "ruby" },
    java: { icon: SiOpenjdk, color: "#007396", slug: "openjdk" },
    rhel: { icon: SiRedhat, color: "#EE0000", slug: "redhat" },
    fedora: { icon: SiFedora, color: "#294172", slug: "fedora" }
  };

  const matched = baseMap[cleanName];

  // 3. Logic: CDN (Highest Detail) -> Brand Map (Themed) -> Docker Default
  if (cleanName && !hasError) {
    const slug = matched?.slug || cleanName;
    return (
      <div style={{ width: size, height: size }} className="flex items-center justify-center p-0.5">
        <img
          src={`https://cdn.simpleicons.org/${slug}`}
          alt={cleanName}
          className="w-full h-full object-contain"
          onError={() => setHasError(true)}
        />
      </div>
    );
  }

  const IconComponent = matched ? matched.icon : SiDocker;
  const iconColor = matched ? matched.color : "#2496ED"; // Docker Blue

  return (
    <div style={{ width: size, height: size }} className="flex items-center justify-center">
      <IconComponent 
        className="w-full h-full" 
        style={{ color: iconColor }} 
        title={`Base: ${imageName}`} 
      />
    </div>
  );
};
