import { useRouter } from "@tanstack/react-router";
import type { AnchorHTMLAttributes, MouseEvent } from "react";

/**
 * An in-app link by URL. A plain click navigates inside the SPA; modified clicks (new tab, …) keep
 * the browser's behavior. Shared components use it because the routes they point to are defined by
 * the pages, not by the shell.
 */
export function AppLink({
  href,
  onClick,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const router = useRouter();
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      props.target === "_blank"
    )
      return;
    event.preventDefault();
    void router.navigate({ href });
  };
  return <a href={href} onClick={handleClick} {...props} />;
}
