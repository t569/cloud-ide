// Searchable base-image picker: query Docker Hub, pick a repo, then a real tag,
// and write "repo:tag" to the form — so users can't hand-type a nonexistent ref
// (e.g. python:22.04) that only fails deep in the build.
import React, { useEffect, useRef, useState } from 'react';
import { VscSearch, VscVerifiedFilled, VscStarFull, VscError, VscLoading, VscArrowLeft } from 'react-icons/vsc';
import { ImageResult, searchImages, listImageTags } from '../../services/api/imageApi';

export const BaseImageSearch = ({ onSelect }: { onSelect: (ref: string) => void }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ImageResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  // Tag step: once a repo is chosen we swap the results panel for its tags.
  const [repo, setRepo] = useState<ImageResult | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);

  const boxRef = useRef<HTMLDivElement>(null);

  // Debounced search.
  useEffect(() => {
    const q = query.trim();
    if (repo) return; // in tag-picking mode; ignore query edits
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    setError(null);
    const t = setTimeout(async () => {
      try {
        const { results } = await searchImages(q);
        setResults(results);
        setOpen(true);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [query, repo]);

  // Close on outside click.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pickRepo = async (r: ImageResult) => {
    setRepo(r);
    setLoadingTags(true);
    setError(null);
    try {
      const { tags } = await listImageTags(r.name);
      setTags(tags);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingTags(false);
    }
  };

  const pickTag = (tag: string) => {
    if (!repo) return;
    onSelect(`${repo.name}:${tag}`);
    setOpen(false);
    setRepo(null);
    setTags([]);
    setQuery('');
    setResults([]);
  };

  const backToResults = () => {
    setRepo(null);
    setTags([]);
    setOpen(true);
  };

  return (
    <div ref={boxRef} className="relative font-sans">
      <div
        className={`flex items-center bg-[#161616] border rounded-lg transition-all ${
          error
            ? 'border-red-500/50 ring-2 ring-red-500/15'
            : 'border-white/[0.08] focus-within:border-[#3574d4] focus-within:ring-2 focus-within:ring-[#3574d4]/25'
        }`}
      >
        <VscSearch className="text-gray-500 ml-3 flex-shrink-0" size={15} />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && !repo && setOpen(true)}
          placeholder="Search Docker Hub for a base image (e.g. python, node, ubuntu)…"
          className="w-full p-2 pl-2.5 bg-transparent text-gray-200 font-jetbrains text-sm outline-none placeholder:text-gray-600"
        />
        {searching && <VscLoading className="animate-spin text-[#3574d4] mr-3 flex-shrink-0" size={14} />}
      </div>

      {error && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-[#2d0a0a] border border-red-500/30 rounded-lg shadow-2xl z-50 p-3 flex items-start gap-2 animate-fade-up">
          <VscError className="text-red-400 mt-0.5 flex-shrink-0" size={16} />
          <span className="text-xs text-red-300/80">{error}</span>
        </div>
      )}

      {open && (repo || results.length > 0) && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-[#232323] border border-white/[0.08] rounded-lg shadow-2xl shadow-black/50 z-50 overflow-hidden animate-fade-up">
          {/* Tag-picking mode */}
          {repo ? (
            <div>
              <button
                type="button"
                onClick={backToResults}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-400 hover:text-gray-200 hover:bg-white/[0.04] border-b border-white/[0.06] transition-colors"
              >
                <VscArrowLeft size={13} /> <span className="font-jetbrains text-[#4EC9B0]">{repo.name}</span> · pick a tag
              </button>
              {loadingTags ? (
                <div className="p-4 text-center text-xs text-gray-500 flex items-center justify-center gap-2">
                  <VscLoading className="animate-spin" size={13} /> loading tags…
                </div>
              ) : tags.length === 0 ? (
                <div className="p-4 text-center text-xs text-gray-500">No tags found.</div>
              ) : (
                <div className="max-h-56 overflow-y-auto scrollbar-thin flex flex-wrap gap-1.5 p-2.5">
                  {tags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => pickTag(tag)}
                      className="font-jetbrains text-[11px] px-2 py-1 rounded-md border border-white/[0.08] bg-white/[0.04] text-gray-200 hover:border-[#3574d4]/60 hover:bg-[#3574d4]/10 transition-colors"
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* Repo results */
            <div className="max-h-64 overflow-y-auto scrollbar-thin divide-y divide-white/[0.05]">
              {results.map((r) => (
                <div
                  key={r.name}
                  onClick={() => pickRepo(r)}
                  className="flex items-start gap-3 p-3 hover:bg-white/[0.04] cursor-pointer transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-sm font-bold text-[#4EC9B0] font-jetbrains truncate">{r.name}</span>
                      {r.official && <VscVerifiedFilled className="text-[#3574d4] flex-shrink-0" size={13} title="Official image" />}
                    </div>
                    {r.description && <p className="text-xs text-gray-400 truncate">{r.description}</p>}
                  </div>
                  {typeof r.stars === 'number' && (
                    <span className="flex items-center gap-1 text-[10px] text-gray-500 flex-shrink-0 pt-0.5">
                      <VscStarFull size={11} /> {r.stars.toLocaleString()}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
