// Framework-free modal dialogs — the styled replacement for window.confirm /
// window.prompt. Same shape as toastStore (module-level state + useSyncExternalStore,
// no Provider), so it costs nothing until a dialog is actually open. Await the call:
//   if (await dialog.confirm({ title: 'Delete file?', danger: true })) { ... }
//   const name = await dialog.prompt({ title: 'New file', placeholder: '/index.ts' });
import { useSyncExternalStore } from 'react';

export type DialogKind = 'confirm' | 'prompt';

export interface DialogRequest {
  id: number;
  kind: DialogKind;
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
  // prompt only:
  inputLabel?: string;
  placeholder?: string;
  defaultValue?: string;
  resolve: (value: boolean | string | null) => void;
}

let current: DialogRequest | null = null;
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function open(req: Omit<DialogRequest, 'id' | 'resolve'>): Promise<boolean | string | null> {
  return new Promise((resolve) => {
    // Single modal at a time: a new one cancels whatever was open.
    if (current) current.resolve(current.kind === 'prompt' ? null : false);
    current = { ...req, id: nextId++, resolve };
    emit();
  });
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface PromptOptions {
  title: string;
  message?: string;
  inputLabel?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export const dialog = {
  confirm(opts: ConfirmOptions): Promise<boolean> {
    return open({
      kind: 'confirm',
      title: opts.title,
      message: opts.message,
      confirmLabel: opts.confirmLabel ?? 'Confirm',
      cancelLabel: opts.cancelLabel ?? 'Cancel',
      danger: opts.danger ?? false,
    }) as Promise<boolean>;
  },
  prompt(opts: PromptOptions): Promise<string | null> {
    return open({
      kind: 'prompt',
      title: opts.title,
      message: opts.message,
      inputLabel: opts.inputLabel,
      placeholder: opts.placeholder,
      defaultValue: opts.defaultValue,
      confirmLabel: opts.confirmLabel ?? 'Create',
      cancelLabel: opts.cancelLabel ?? 'Cancel',
      danger: false,
    }) as Promise<string | null>;
  },
};

/** Settle the open dialog and clear it. Called by <Dialogs/>. */
export function settleDialog(value: boolean | string | null): void {
  if (!current) return;
  const req = current;
  current = null;
  emit();
  req.resolve(value);
}

export const useDialog = (): DialogRequest | null =>
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => current,
  );
