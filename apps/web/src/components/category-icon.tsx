import { useTranslation } from "react-i18next";

export type CategoryLike = {
  id: number;
  name: string;
  icon: string | null;
  system: boolean;
  color: number;
};

/** A system category's name is an English key; a user's own category keeps its name as typed. */
export function useCategoryLabel() {
  const { t } = useTranslation();
  return (category: Pick<CategoryLike, "name" | "system">) =>
    category.system ? t(category.name) : category.name;
}

/** Round badge with the category's emoji (or first letter) on its chart color; "?" when uncategorized. */
export function CategoryIcon({
  category,
  className = "",
}: {
  category: CategoryLike | null;
  className?: string;
}) {
  const label = useCategoryLabel();
  if (category === null) {
    return (
      <span
        className={`flex shrink-0 items-center justify-center rounded-full bg-amber-100 font-bold text-amber-700 ${className}`}
        aria-hidden="true"
      >
        ?
      </span>
    );
  }
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full font-bold text-slate-700 ${className}`}
      style={{
        backgroundColor: `color-mix(in srgb, var(--c-chart-${category.color}) 32%, transparent)`,
      }}
      aria-hidden="true"
    >
      {category.icon ? category.icon : label(category).charAt(0).toLocaleUpperCase()}
    </span>
  );
}
