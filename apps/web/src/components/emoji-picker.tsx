import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

const GROUPS: [string, string[]][] = [
  [
    "Spending",
    [
      "🍜",
      "🍚",
      "🥖",
      "🍱",
      "🍲",
      "🍕",
      "☕",
      "🧋",
      "🍺",
      "🍰",
      "🛒",
      "🥬",
      "🛵",
      "🚗",
      "🚕",
      "⛽",
      "🅿️",
      "🚌",
      "✈️",
      "🏨",
      "🏖️",
      "🧳",
      "🛍️",
      "👕",
      "👟",
      "👜",
      "💄",
      "💇",
      "💍",
      "⌚",
      "🧾",
      "💡",
      "💧",
      "🔥",
      "📱",
      "🌐",
      "📺",
      "🏠",
      "🛋️",
      "🧹",
      "🔧",
      "🛠️",
      "🎮",
      "🎬",
      "🎵",
      "🎤",
      "⚽",
      "🏋️",
      "🎂",
      "🎁",
      "💝",
      "🙏",
      "💊",
      "🏥",
      "🦷",
      "👓",
      "💉",
      "📚",
      "🎓",
      "✏️",
      "👶",
      "🍼",
      "🧸",
      "🐶",
      "🐱",
      "🏧",
      "💳",
      "🔁",
      "📦",
    ],
  ],
  [
    "Earnings",
    [
      "💰",
      "💵",
      "💸",
      "🪙",
      "🏦",
      "🧧",
      "💼",
      "👔",
      "💻",
      "🧑‍💻",
      "🧑‍🏫",
      "🏆",
      "🎖️",
      "📈",
      "📊",
      "💹",
      "🐷",
      "💎",
      "🔑",
      "🏡",
      "🏷️",
      "🤝",
      "🚚",
      "🌾",
      "↩️",
      "🎉",
      "➕",
    ],
  ],
];

type EmojiPickerProps = {
  value: string;
  onChange: (emoji: string) => void;
  label: string;
  /** Open above the button, for pickers near the bottom of a dialog. */
  up?: boolean;
};

/** A button showing the chosen emoji that opens a grid of emojis; "No icon" clears it. */
export function EmojiPicker({ value, onChange, label, up = false }: EmojiPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const choose = (emoji: string) => {
    onChange(emoji);
    setOpen(false);
  };

  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={label}
        className="flex h-11 w-12 items-center justify-center rounded-xl border border-slate-300 bg-white text-xl hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
      >
        <span className="text-slate-500">{value || "＋"}</span>
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label={label}
          className={`absolute left-0 z-30 ${up ? "bottom-full mb-2" : "mt-2"} max-h-80 w-[17.5rem] overflow-y-auto overscroll-contain rounded-2xl bg-white p-2 ring-1 ring-slate-200`}
        >
          {GROUPS.map(([group, choices]) => (
            <div key={group}>
              <p className="px-1 pt-1 pb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                {t(group)}
              </p>
              <div className="mb-3 grid grid-cols-6 gap-1">
                {choices.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    role="option"
                    aria-selected={value === emoji}
                    onClick={() => choose(emoji)}
                    className={`flex h-11 w-11 items-center justify-center rounded-lg text-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${value === emoji ? "bg-emerald-100 ring-2 ring-emerald-500" : "hover:bg-slate-100"}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => choose("")}
            className="mt-1 min-h-11 w-full rounded-lg text-sm text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            {t("No icon")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
