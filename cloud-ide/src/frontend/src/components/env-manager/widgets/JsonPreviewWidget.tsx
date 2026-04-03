// src/frontend/src/components/env-manager/widgets/JsonPreviewWidget.tsx

// This component provides a JSON preview of the environment configuration with a copy-to-clipboard feature. It is styled to resemble a JetBrains IDE code editor, complete with a header, scrollable code area, and footer.

import { useState } from 'react';
import { EnvironmentConfig } from '@cloud-ide/shared/types/env';

export const JsonPreviewWidget = ({ config }: { config: EnvironmentConfig }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(config, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-[450px] sticky top-6 h-[calc(100vh-3rem)] flex flex-col bg-[#1e1e1e] border border-gray-700 rounded-lg shadow-2xl overflow-hidden font-jetbrains">
      {/* JetBrains-style Header */}
      <div className="px-4 py-2 bg-[#2d2d2d] border-b border-gray-700 flex items-center justify-between">
        <span className="text-xs text-gray-300 font-semibold tracking-wide">schema.json</span>
        <button 
          onClick={handleCopy}
          className="text-xs px-2 py-1 bg-[#3c3f41] hover:bg-[#4b4d4f] text-gray-300 rounded transition"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      
      {/* Scrollable Code Area */}
      <div className="flex-1 p-4 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600">
        <pre className="text-[12px] leading-relaxed text-[#a9b7c6]">
          {JSON.stringify(config, null, 2)}
        </pre>
      </div>
      
      {/* JetBrains-style Footer */}
      <div className="p-2 bg-[#2d2d2d] border-t border-gray-700 text-[10px] text-gray-400 flex justify-between">
        <span>UTF-8</span>
        <span>4 spaces</span>
      </div>
    </div>
  );
};