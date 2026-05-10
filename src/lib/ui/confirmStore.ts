import { create } from 'zustand';

export interface ConfirmRequest {
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface ConfirmState {
  open: boolean;
  request: ConfirmRequest | null;
  resolve: ((value: boolean) => void) | null;
  ask: (request: ConfirmRequest | string) => Promise<boolean>;
  answer: (value: boolean) => void;
}

// WebView2 silently ignores window.confirm() in the production Tauri build,
// so the native browser dialog is unreliable for friend installs. This store
// drives an in-app modal that works the same in dev and in WebView2.
export const useConfirmStore = create<ConfirmState>((set, get) => ({
  open: false,
  request: null,
  resolve: null,
  ask: (req) => {
    const request = typeof req === 'string' ? { message: req } : req;
    return new Promise<boolean>((resolve) => {
      const prev = get().resolve;
      if (prev) prev(false);
      set({ open: true, request, resolve });
    });
  },
  answer: (value) => {
    const r = get().resolve;
    set({ open: false, request: null, resolve: null });
    if (r) r(value);
  },
}));

export function confirm(request: ConfirmRequest | string): Promise<boolean> {
  return useConfirmStore.getState().ask(request);
}
