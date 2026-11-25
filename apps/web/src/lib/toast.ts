import { useSyncExternalStore } from "react";

export type ToastLink = { to: string; label: string };
export type Toast = { id: number; message: string; tone: "success" | "error"; link?: ToastLink };

type State = { toast: Toast | null; demoReadOnly: number };

let state: State = { toast: null, demoReadOnly: 0 };
const listeners = new Set<() => void>();
let nextId = 1;

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

/** Shows a short message at the bottom of the screen, replacing the one shown before. */
export function showToast(
  message: string,
  options: { tone?: Toast["tone"]; link?: ToastLink } = {},
) {
  set({ toast: { id: nextId++, message, tone: options.tone ?? "success", link: options.link } });
}

export function dismissToast(id: number) {
  if (state.toast?.id === id) set({ toast: null });
}

/** Shows (or restarts) the "demo data is read-only" notice. */
export function showDemoReadOnly() {
  set({ demoReadOnly: nextId++ });
}

export function dismissDemoReadOnly() {
  set({ demoReadOnly: 0 });
}

export function useToasts(): State {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}
