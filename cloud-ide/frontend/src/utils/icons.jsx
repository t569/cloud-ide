import React from 'react';
import { 
  SiJavascript, SiPython, SiHtml5, SiReact, SiRust, 
  SiCplusplus, SiC, SiTypescript 
} from 'react-icons/si'; // Removed SiCss3 from here
import { FaJava, FaCss3Alt } from 'react-icons/fa'; // Added FaCss3Alt here
import { VscFile, VscMarkdown, VscJson, VscTerminal, VscFileCode } from 'react-icons/vsc';

export const getFileIcon = (name) => {
  if (!name) return <VscFile color="#cccccc" size={14} />;
  
  const lowerName = name.toLowerCase();

  // Web
  if (lowerName.endsWith('.js')) return <SiJavascript color="#f7df1e" size={14} />;
  if (lowerName.endsWith('.jsx') || lowerName.endsWith('.tsx')) return <SiReact color="#61dafb" size={14} />;
  if (lowerName.endsWith('.ts')) return <SiTypescript color="#3178c6" size={14} />;
  if (lowerName.endsWith('.html')) return <SiHtml5 color="#e34f26" size={14} />;
  if (lowerName.endsWith('.css')) return <FaCss3Alt color="#1572b6" size={14} />; // Updated!
  if (lowerName.endsWith('.json')) return <VscJson color="#cbd642" size={14} />;
  
  // Systems & Backend
  if (lowerName.endsWith('.py')) return <SiPython color="#3776ab" size={14} />;
  if (lowerName.endsWith('.rs')) return <SiRust color="#dea584" size={14} />;
  if (lowerName.endsWith('.cpp') || lowerName.endsWith('.cc') || lowerName.endsWith('.cxx')) return <SiCplusplus color="#00599c" size={14} />;
  if (lowerName.endsWith('.c')) return <SiC color="#a8b9cc" size={14} />;
  if (lowerName.endsWith('.java')) return <FaJava color="#b07219" size={14} />;
  
  // Scripts & Assembly
  if (lowerName.endsWith('.sh') || lowerName.endsWith('.bash')) return <VscTerminal color="#4af626" size={14} />;
  if (lowerName.endsWith('.asm') || lowerName.endsWith('.s')) return <VscFileCode color="#f74239" size={14} />; // Red generic code icon for ASM
  
  // Docs
  if (lowerName.endsWith('.md')) return <VscMarkdown color="#083fa1" size={14} />;

  // Default fallback
  return <VscFile color="#cccccc" size={14} />;
};