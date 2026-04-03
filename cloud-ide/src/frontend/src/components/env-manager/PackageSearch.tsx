// src/frontend/src/components/env-manager/PackageSearch.tsx

// This component provides a search interface for packages across different ecosystems (npm, pip, apt). It is styled to fit within the VS Code theme and can be hooked up to real package search APIs in the future.

import { useState } from 'react';

export const PackageSearch = () => {
  const [query, setQuery] = useState('');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: Hook this up to an API (like npms.io, PyPI, or Ubuntu packages) later
    console.log(`Searching for: ${query}`);
  };

  return (
    <div className="mb-6 p-4 bg-[#2b2b2b] border border-[#3c3f41] rounded-lg">
      <h3 className="text-sm font-semibold text-gray-200 mb-2 font-sans">Library Search</h3>
      <form onSubmit={handleSearch} className="flex gap-2">
        <input 
          type="text" 
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search npm, pip, or apt packages..." 
          className="flex-1 p-2 bg-[#1e1e1e] border border-[#3c3f41] rounded text-gray-300 font-jetbrains text-sm focus:border-[#569cd6] outline-none transition"
        />
        <button type="submit" className="px-4 py-2 bg-[#3c3f41] hover:bg-[#4b4d4f] text-gray-200 text-sm rounded font-sans transition">
          Search
        </button>
      </form>
    </div>
  );
};