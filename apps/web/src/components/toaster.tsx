import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useExitDemo } from "../lib/demo";
import { dismissDemoReadOnly, dismissToast, useToasts } from "../lib/toast";
import { AppLink } from "./app-link";

const DISMISS_AFTER_MS = 4000;
const DEMO_NOTICE_MS = 8000;

const PLACEMENT =
  "fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-30 rounded-2xl px-4 py-3 text-sm shadow-lg ring-1 sm:left-auto sm:right-6 sm:w-96";

/**
 * The flash message (replacing Laravel's session flash) and the demo read-only notice. A flash with
 * a link stays twice as long so there is time to tap it.
 */
export function Toaster() {
  const { t } = useTranslation();
  const { toast, demoReadOnly } = useToasts();
  const exitDemo = useExitDemo();

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(
      () => dismissToast(toast.id),
      toast.link ? DISMISS_AFTER_MS * 2 : DISMISS_AFTER_MS,
    );
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!demoReadOnly) return;
    const timer = setTimeout(dismissDemoReadOnly, DEMO_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [demoReadOnly]);

  return (
    <>
      {toast ? (
        <div
          key={toast.id}
          role="status"
          className={`${PLACEMENT} ${toast.tone === "error" ? "bg-red-50 text-red-800 ring-red-200" : "bg-emerald-50 text-emerald-800 ring-emerald-200"}`}
        >
          {toast.message}{" "}
          {toast.link ? (
            <AppLink href={toast.link.to} className="font-semibold underline">
              {toast.link.label}
            </AppLink>
          ) : null}
        </div>
      ) : null}
      {demoReadOnly ? (
        <div role="alert" className={`${PLACEMENT} bg-amber-50 text-amber-900 ring-amber-200`}>
          {t(
            "This is demo data, so changes can't be saved or deleted. Switch back to your account to make changes.",
          )}{" "}
          <button
            type="button"
            onClick={() => exitDemo.mutate()}
            disabled={exitDemo.isPending}
            className="font-semibold underline"
          >
            {t("Exit demo mode")}
          </button>
        </div>
      ) : null}
    </>
  );
}
