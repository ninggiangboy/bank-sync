import { type CategoryType, categoryTypeFor, type Direction } from "@bank-sync/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CategoryIcon, type CategoryLike, useCategoryLabel } from "./category-icon";
import { Icon } from "./icon";
import { Modal } from "./modal";

export type PickerCategory = CategoryLike & { type: CategoryType; parentId: number | null };

export const CATEGORY_TYPE_LABELS: Record<CategoryType, string> = {
  expense: "Expense",
  income: "Income",
  debt_loan: "Debt/Loan",
};

type CategoryPickerProps = {
  categories: PickerCategory[];
  direction: Direction;
  selected: number | null;
  onSelect: (id: number) => void;
  className?: string;
};

/**
 * A card showing the selected category; tapping it opens the category tree in a sheet, tabbed by
 * type and opened on the selected category's tab. Picking a category closes the sheet.
 */
export function CategoryPicker({
  categories,
  direction,
  selected,
  onSelect,
  className = "",
}: CategoryPickerProps) {
  const { t } = useTranslation();
  const label = useCategoryLabel();
  const types: CategoryType[] = [categoryTypeFor(direction), "debt_loan"];
  const current = categories.find((category) => category.id === selected) ?? null;
  const currentParent = current?.parentId
    ? (categories.find((category) => category.id === current.parentId) ?? null)
    : null;
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<CategoryType>(current?.type ?? types[0] ?? "expense");

  const pick = (id: number) => {
    setOpen(false);
    onSelect(id);
  };

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => {
          setTab(current?.type ?? types[0] ?? "expense");
          setOpen(true);
        }}
        aria-haspopup="dialog"
        className="flex min-h-14 w-full items-center gap-3 rounded-xl bg-white px-2 text-left ring-1 ring-slate-200 hover:bg-emerald-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
      >
        <CategoryIcon category={current} className="h-10 w-10 text-xl" />
        <span className="min-w-0 flex-1">
          {current === null ? (
            <span className="block font-medium text-slate-500">{t("Choose a category")}</span>
          ) : (
            <>
              {currentParent ? (
                <span className="block truncate text-xs text-slate-500">
                  {label(currentParent)}
                </span>
              ) : null}
              <span className="block truncate font-semibold">{label(current)}</span>
            </>
          )}
        </span>
        <Icon name="chevron-down" className="h-5 w-5 shrink-0 text-slate-500" />
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        maxWidth="md"
        sheet
        labelledBy="category-picker-title"
      >
        <div className="px-4 pb-4">
          <div className="sticky top-0 z-10 -mx-4 bg-white px-4">
            <div className="flex items-center justify-between gap-2 py-3">
              <h2 id="category-picker-title" className="text-lg font-semibold">
                {t("Choose a category")}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="-mr-2 flex min-h-11 min-w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                aria-label={t("Close")}
              >
                <Icon name="x" className="h-5 w-5" />
              </button>
            </div>

            <fieldset className="tabs" aria-label={t("Category type")}>
              {types.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setTab(type)}
                  aria-pressed={tab === type}
                  className="tab"
                >
                  {t(CATEGORY_TYPE_LABELS[type])}
                </button>
              ))}
            </fieldset>
          </div>

          <ul className="mt-3 space-y-2">
            {categories
              .filter((category) => category.type === tab && category.parentId === null)
              .map((parent) => {
                const children = categories.filter((category) => category.parentId === parent.id);
                return (
                  <li key={parent.id}>
                    <PickerRow category={parent} selected={selected} onPick={pick} />
                    {children.length > 0 ? (
                      // Tree lines start under the parent icon (center at 28px): a rounded elbow to each
                      // child's box, continuing down only while more children follow.
                      <ul>
                        {children.map((child, index) => (
                          <li
                            key={child.id}
                            className={`relative pt-2 pl-12 before:absolute before:top-0 before:left-[28px] before:h-[calc(50%+0.25rem)] before:w-[20px] before:rounded-bl-lg before:border-b before:border-l before:border-slate-300 before:content-[''] ${index < children.length - 1 ? "after:absolute after:top-1/2 after:bottom-0 after:left-[28px] after:border-l after:border-slate-300 after:content-['']" : ""}`}
                          >
                            <PickerRow category={child} selected={selected} onPick={pick} child />
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
          </ul>
        </div>
      </Modal>
    </div>
  );
}

/** One row of the picker; a child row is a bit smaller than a top-level one. */
function PickerRow({
  category,
  selected,
  onPick,
  child = false,
}: {
  category: PickerCategory;
  selected: number | null;
  onPick: (id: number) => void;
  child?: boolean;
}) {
  const label = useCategoryLabel();
  const isSelected = selected === category.id;
  return (
    <button
      type="button"
      onClick={() => onPick(category.id)}
      aria-pressed={isSelected}
      className={`flex w-full items-center gap-3 rounded-xl px-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${child ? "min-h-12 text-sm" : "min-h-14 text-base font-medium"} ${isSelected ? "bg-emerald-100 font-semibold" : "bg-white ring-1 ring-slate-200 hover:bg-emerald-50"}`}
    >
      <CategoryIcon
        category={category}
        className={child ? "h-8 w-8 text-lg" : "h-10 w-10 text-xl"}
      />
      <span className="min-w-0 flex-1 truncate">{label(category)}</span>
      {isSelected ? <Icon name="check" className="mr-1 h-5 w-5 shrink-0 text-emerald-700" /> : null}
    </button>
  );
}
