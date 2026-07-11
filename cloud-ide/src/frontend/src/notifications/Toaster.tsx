// Mount once (e.g. in main.tsx). Portals a neon-outlined toast stack to <body>.
import React from 'react';
import { createPortal } from 'react-dom';
import { VscPass, VscWarning, VscError, VscInfo, VscClose } from 'react-icons/vsc';
import { Toast, ToastType, toast, useToasts } from './toastStore';

const CONFIG: Record<ToastType, { icon: React.ComponentType<{ size?: number }>; color: string; label: string }> = {
  success: { icon: VscPass, color: '#34d399', label: 'Success' }, // emerald neon
  warning: { icon: VscWarning, color: '#fbbf24', label: 'Warning' }, // amber neon
  error: { icon: VscError, color: '#f87171', label: 'Error' }, // red neon
  info: { icon: VscInfo, color: '#60a5fa', label: 'Info' }, // azure neon
};

const ToastCard = ({ t }: { t: Toast }) => {
  const { icon: Icon, color, label } = CONFIG[t.type];
  return (
    <div
      role="alert"
      className="pointer-events-auto relative w-80 overflow-hidden rounded-xl border bg-[#141418]/90 backdrop-blur-md px-4 py-3 pr-9 font-sans animate-[toastIn_0.22s_cubic-bezier(0.2,0.9,0.3,1.4)_both]"
      style={{
        borderColor: color,
        // layered neon: crisp ring + soft outer glow + depth shadow
        boxShadow: `0 0 0 1px ${color}55, 0 0 18px -4px ${color}, 0 12px 32px -12px rgba(0,0,0,0.7)`,
      }}
    >
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 flex-shrink-0"
          style={{ color, filter: `drop-shadow(0 0 6px ${color}aa)` }}
        >
          <Icon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-tight" style={{ color }}>
            {t.title ?? label}
          </p>
          <p className="mt-0.5 text-[13px] leading-snug text-gray-300 break-words">{t.message}</p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => toast.dismiss(t.id)}
        aria-label="Dismiss notification"
        className="absolute right-2 top-2.5 rounded p-1 text-gray-500 transition-colors hover:bg-white/10 hover:text-gray-200"
      >
        <VscClose size={14} />
      </button>

      {t.duration > 0 && (
        <span
          className="absolute bottom-0 left-0 h-[2px]"
          style={{
            backgroundColor: color,
            boxShadow: `0 0 8px ${color}`,
            animation: `toastShrink ${t.duration}ms linear forwards`,
          }}
        />
      )}
    </div>
  );
};

export const Toaster = () => {
  const toasts = useToasts();
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="pointer-events-none fixed right-4 top-4 z-[9999] flex flex-col gap-3">
      {toasts.map((t) => (
        <ToastCard key={t.id} t={t} />
      ))}
    </div>,
    document.body,
  );
};
