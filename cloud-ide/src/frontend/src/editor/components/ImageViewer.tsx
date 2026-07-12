// Renders an image file from the workspace. Monaco is a text editor — pointed at a
// PNG it shows decoded mojibake — so image tabs bypass it entirely and land here.
//
// The bytes come from GET /fs/:id/raw via fetch + a blob URL rather than a direct
// <img src={apiUrl}>: the API authenticates by cookie, and a plain <img> request
// won't carry it once the frontend and backend aren't same-site. fetch with
// credentials:'include' is the same path the rest of the app already uses.
import React, { useEffect, useState } from 'react';
import { rawFileUrl } from '../core/VFSController';

interface ImageViewerProps {
  sandboxId: string;
  path: string;
}

export const ImageViewer = ({ sandboxId, path }: ImageViewerProps) => {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let live = true;

    setSrc(null);
    setError(null);

    fetch(rawFileUrl(sandboxId, path), { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error(`Could not load image (HTTP ${res.status})`);
        return res.blob();
      })
      .then((blob) => {
        if (!live) return; // tab switched away mid-fetch
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch((e: Error) => live && setError(e.message));

    // Revoke on unmount / path change, or every viewed image leaks its blob.
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [sandboxId, path]);

  const name = path.split('/').pop();

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-auto bg-[#1e1e1e] p-6">
      {error ? (
        <p className="text-sm text-red-300">{error}</p>
      ) : !src ? (
        <p className="text-sm text-[#8a8a8a]">Loading {name}…</p>
      ) : (
        <>
          {/* Checkerboard makes a transparent PNG readable instead of black-on-black. */}
          <img
            src={src}
            alt={name}
            className="max-h-[calc(100%-2rem)] max-w-full object-contain"
            style={{
              backgroundImage:
                'linear-gradient(45deg, #2a2a2a 25%, transparent 25%, transparent 75%, #2a2a2a 75%),' +
                'linear-gradient(45deg, #2a2a2a 25%, transparent 25%, transparent 75%, #2a2a2a 75%)',
              backgroundSize: '16px 16px',
              backgroundPosition: '0 0, 8px 8px',
            }}
          />
          <span className="text-xs text-[#8a8a8a]">{name}</span>
        </>
      )}
    </div>
  );
};
