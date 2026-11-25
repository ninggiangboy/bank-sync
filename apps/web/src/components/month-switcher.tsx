import { useTranslation } from "react-i18next";
import { addMonths, currentMonth, monthLabel } from "../lib/format";
import { Icon } from "./icon";

const BUTTON =
  "flex h-11 w-11 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-30 disabled:hover:bg-transparent";

/** Previous / next month around a `YYYY-MM` label; months after the current one are not offered. */
export function MonthSwitcher({
  month,
  onChange,
}: {
  month: string;
  onChange: (month: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between">
      <button
        type="button"
        onClick={() => onChange(addMonths(month, -1))}
        className={BUTTON}
        aria-label={t("Previous month")}
      >
        <Icon name="chevron-left" />
      </button>
      <p className="font-semibold" aria-live="polite">
        {monthLabel(month)}
      </p>
      <button
        type="button"
        onClick={() => onChange(addMonths(month, 1))}
        disabled={month >= currentMonth()}
        className={BUTTON}
        aria-label={t("Next month")}
      >
        <Icon name="chevron-right" />
      </button>
    </div>
  );
}
