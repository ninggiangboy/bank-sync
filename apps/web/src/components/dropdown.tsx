import { type ReactNode, useEffect, useRef, useState } from "react";

const ALIGN = {
  left: "start-0 origin-top-left",
  top: "origin-top",
  right: "end-0 origin-top-right",
} as const;

type DropdownProps = {
  trigger: ReactNode;
  children: ReactNode;
  align?: keyof typeof ALIGN;
  width?: string;
  contentClassName?: string;
};

/** A menu that opens under its trigger and closes on an outside click, Escape or a pick inside. */
export function Dropdown({
  trigger,
  children,
  align = "right",
  width = "w-48",
  contentClassName = "bg-white py-1",
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: the trigger inside is the focusable control. */}
      <div onClick={() => setOpen(!open)}>{trigger}</div>
      {open ? (
        // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: closes after a pick made with the items' own controls.
        <div
          className={`absolute z-50 mt-2 rounded-md shadow-lg ${width} ${ALIGN[align]}`}
          onClick={() => setOpen(false)}
        >
          <div className={`rounded-md ring-1 ring-black/5 ${contentClassName}`}>{children}</div>
        </div>
      ) : null}
    </div>
  );
}
