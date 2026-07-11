// Mount once (next to <Toaster/>). Portals the active confirm/prompt dialog to
// <body>. Renders nothing when idle — no overhead until a dialog is opened.
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { VscWarning, VscEdit, VscQuestion } from 'react-icons/vsc';
import { DialogRequest, settleDialog, useDialog } from './dialogStore';

// One accent per intent — azure for a normal ask, red for a destructive one. Drives
// the icon, the input focus ring, and the primary button, so intent reads instantly.
const accentFor = (req: DialogRequest) => (req.danger ? '#f87171' : '#60a5fa');
const iconFor = (req: DialogRequest) =>
  req.danger ? VscWarning : req.kind === 'prompt' ? VscEdit : VscQuestion;

const DialogCard = ({ req }: { req: DialogRequest }) => {
  const accent = accentFor(req);
  const Icon = iconFor(req);
  const [value, setValue] = useState(req.defaultValue ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Focus the input (prompt) or the primary button (confirm) on open, and select the
  // default so a path can be retyped or extended immediately.
  useEffect(() => {
    if (req.kind === 'prompt') {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else {
      confirmRef.current?.focus();
    }
  }, [req.id, req.kind]);

  const cancel = () => settleDialog(req.kind === 'prompt' ? null : false);
  const confirm = () => {
    if (req.kind === 'prompt') {
      const trimmed = value.trim();
      if (!trimmed) return; // nothing to submit
      settleDialog(trimmed);
    } else {
      settleDialog(true);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    if (e.key === 'Enter' && req.kind === 'prompt') { e.preventDefault(); confirm(); }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`dlg-title-${req.id}`}
      onKeyDown={onKeyDown}
      className="w-[420px] max-w-[92vw] overflow-hidden rounded-xl border bg-[#161619] font-sans animate-dialog-in"
      style={{
        borderColor: `${accent}66`,
        boxShadow: `0 0 0 1px ${accent}33, 0 0 40px -12px ${accent}, 0 24px 60px -20px rgba(0,0,0,0.8)`,
      }}
    >
      <div className="flex items-start gap-3 px-5 pt-5">
        <span
          className="mt-0.5 flex-shrink-0"
          style={{ color: accent, filter: `drop-shadow(0 0 6px ${accent}88)` }}
        >
          <Icon size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`dlg-title-${req.id}`} className="text-[15px] font-semibold leading-tight text-gray-100">
            {req.title}
          </h2>
          {req.message && (
            <p className="mt-1.5 text-[13px] leading-relaxed text-gray-400 break-words">{req.message}</p>
          )}
        </div>
      </div>

      {req.kind === 'prompt' && (
        <div className="px-5 pt-4">
          {req.inputLabel && (
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-gray-500">
              {req.inputLabel}
            </label>
          )}
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={req.placeholder}
            spellCheck={false}
            autoComplete="off"
            className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-[13px] text-gray-100 placeholder:text-gray-600 outline-none transition-shadow"
            style={{ boxShadow: 'none' }}
            onFocus={(e) => (e.currentTarget.style.boxShadow = `0 0 0 2px ${accent}66`)}
            onBlur={(e) => (e.currentTarget.style.boxShadow = 'none')}
          />
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2 border-t border-white/5 bg-black/20 px-5 py-3">
        <button
          type="button"
          onClick={cancel}
          className="rounded-lg px-3.5 py-1.5 text-[13px] font-medium text-gray-400 transition-colors hover:bg-white/5 hover:text-gray-200"
        >
          {req.cancelLabel}
        </button>
        <button
          ref={confirmRef}
          type="button"
          onClick={confirm}
          className="rounded-lg px-3.5 py-1.5 text-[13px] font-semibold text-black transition-transform active:scale-95"
          style={{ backgroundColor: accent, boxShadow: `0 0 16px -4px ${accent}` }}
        >
          {req.confirmLabel}
        </button>
      </div>
    </div>
  );
};

export const Dialogs = () => {
  const req = useDialog();
  if (typeof document === 'undefined' || !req) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-overlay-in"
      onMouseDown={(e) => {
        // Click the backdrop (not the card) to dismiss.
        if (e.target === e.currentTarget) settleDialog(req.kind === 'prompt' ? null : false);
      }}
    >
      <DialogCard req={req} />
    </div>,
    document.body,
  );
};
