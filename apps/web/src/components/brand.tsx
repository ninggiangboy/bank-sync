import { useQuery } from "@tanstack/react-query";
import { configQuery } from "../lib/queries";
import { AppLink } from "./app-link";

/** "BankSync"-style wordmark: the first word bold, the rest regular, after the app icon. */
export function Brand({ size = "md" }: { size?: "md" | "lg" }) {
  const { data: config } = useQuery(configQuery);
  const name = config?.appName ?? "Bank Sync";
  const [head = name, ...tail] = name.split(" ");
  const large = size === "lg";
  return (
    <AppLink
      href="/"
      aria-label={name}
      className={`inline-flex min-h-11 items-center gap-2.5 tracking-tighter text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 ${large ? "text-2xl" : "text-xl"}`}
    >
      <img src="/icon.svg" alt="" className={`${large ? "h-10 w-10" : "h-8 w-8"} rounded-[22%]`} />
      <span aria-hidden="true">
        <span className="font-bold">{head}</span>
        <span className="font-normal">{tail.join("")}</span>
      </span>
    </AppLink>
  );
}
