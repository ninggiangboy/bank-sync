import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { configQuery } from "../lib/queries";
import { Icon } from "./icon";

/** The banks Bank Sync can read, and where to ask for another one. */
export function SupportedBanks() {
  const { t } = useTranslation();
  const { data: config } = useQuery(configQuery);
  return (
    <div>
      <h2 id="banks-heading" className="font-semibold">
        {t("Supported banks")}
      </h2>
      <ul className="mt-2 flex flex-wrap gap-2">
        {config?.banks.map((bank) => (
          <li
            key={bank.bankCode}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-white px-3.5 text-sm font-medium shadow-sm ring-1 ring-slate-200"
          >
            <Icon name="check" className="h-4 w-4 text-emerald-600" /> {bank.name}
          </li>
        ))}
      </ul>
      {config ? (
        <p className="mt-4 text-sm leading-relaxed text-slate-700">
          {t("Need support for your bank or found a bug?")}{" "}
          <a
            href={config.sourceUrl}
            target="_blank"
            rel="noopener"
            className="font-medium text-emerald-700 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            {t("Open an issue on the source code page")}
          </a>
        </p>
      ) : null}
    </div>
  );
}
