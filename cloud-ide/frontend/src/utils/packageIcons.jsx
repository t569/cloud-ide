import React from 'react';
import { SiPython, SiNodedotjs, SiReact, SiPandas, SiNumpy, SiTensorflow, SiDocker } from 'react-icons/si';
import { VscPackage } from 'react-icons/vsc';

// A simple mapper to give popular packages nice icons
export const getPackageIcon = (name) => {
  const lower = name.toLowerCase();
  if (lower.includes('react')) return <SiReact color="#61dafb" />;
  if (lower.includes('pandas')) return <SiPandas color="#150458" />;
  if (lower.includes('numpy')) return <SiNumpy color="#013243" />;
  if (lower.includes('tensor')) return <SiTensorflow color="#FF6F00" />;
  if (lower.includes('node') || lower.includes('express')) return <SiNodedotjs color="#339933" />;
  if (lower.includes('python')) return <SiPython color="#3776ab" />;
  if (lower.includes('docker')) return <SiDocker color="#2496ed" />;
  
  return <VscPackage color="#cccccc" />; // Default box icon
};