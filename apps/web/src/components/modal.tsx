import { type ReactNode, useEffect, useRef } from "react";

const WIDTHS = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-md",
  lg: "sm:max-w-lg",
  xl: "sm:max-w-xl",
  "2xl": "sm:max-w-2xl",
} as const;

type ModalProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: keyof typeof WIDTHS;
  /** A bottom sheet on phones (85% of the screen tall), a centered dialog from `sm` up. */
  sheet?: boolean;
  labelledBy?: string;
};

/**
 * A native modal dialog: the browser traps focus, closes on Escape and focuses the first field (or
 * the one marked autofocus). Clicking the backdrop closes it too, and the page behind stops scrolling.
 */
export function Modal({
  open,
  onClose,
  children,
  maxWidth = "2xl",
  sheet = false,
  labelledBy,
}: ModalProps) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      document.body.classList.add("overflow-y-hidden");
    }
    if (!open && element.open) element.close();
    return () => document.body.classList.remove("overflow-y-hidden");
  }, [open]);

  const layout = sheet
    ? "mb-0 mt-auto h-[85dvh] w-full max-w-none overflow-y-auto overscroll-contain rounded-t-2xl pb-[env(safe-area-inset-bottom)] sm:my-6 sm:mt-6 sm:h-[calc(100dvh-3rem)] sm:w-full sm:rounded-lg sm:pb-0"
    : "my-6 w-[calc(100%-2rem)] max-w-none rounded-lg sm:w-full";

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape is handled natively by <dialog>; the click only catches the backdrop.
    <dialog
      ref={dialog}
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
      className={`bg-white p-0 text-slate-900 shadow-xl backdrop:bg-[#100F0F]/60 sm:mx-auto ${WIDTHS[maxWidth]} ${layout}`}
    >
      {open ? children : null}
    </dialog>
  );
}
