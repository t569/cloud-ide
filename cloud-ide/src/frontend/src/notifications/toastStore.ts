// Framework-free toast store: import `toast` anywhere and call it — no Provider,
// no context plumbing. A module-level list + pub/sub, read by <Toaster/> via
// useSyncExternalStore (React's stdlib bridge to external stores).
import { useSyncExternalStore } from 'react';

export type ToastType = 'success' | 'warning' | 'error' | 'info';

export interface Toast {
  id: number;
  type: ToastType;
  message: string;
  title?: string;
  duration: number; // ms; 0 = sticky
}

export interface ToastOptions {
  title?: string;
  duration?: number;
}

const MAX_STACK = 5;
let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

const dismiss = (id: number) => {
  const next = toasts.filter((t) => t.id !== id);
  if (next.length !== toasts.length) {
    toasts = next;
    emit();
  }
};

const push = (type: ToastType, message: string, opts?: ToastOptions): number => {
  const id = nextId++;
  const duration = opts?.duration ?? 4000;
  // newest on top, cap the stack so a runaway loop can't flood the screen
  toasts = [{ id, type, message, title: opts?.title, duration }, ...toasts].slice(0, MAX_STACK);
  emit();
  if (duration > 0) setTimeout(() => dismiss(id), duration);
  return id;
};

export const toast = {
  success: (message: string, opts?: ToastOptions) => push('success', message, opts),
  warning: (message: string, opts?: ToastOptions) => push('warning', message, opts),
  error: (message: string, opts?: ToastOptions) => push('error', message, opts),
  info: (message: string, opts?: ToastOptions) => push('info', message, opts),
  dismiss,
};

// getSnapshot returns the same array reference until a mutation swaps it,
// so useSyncExternalStore won't loop.
export const useToasts = (): Toast[] =>
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => toasts,
    () => toasts,
  );
