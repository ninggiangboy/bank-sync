import type { AnyRouter } from "@tanstack/react-router";

/**
 * Mobile browsers only open the on-screen keyboard when focus happens during a tap, but after a
 * client-side navigation the next page's field mounts later. Links marked
 * `data-keyboard="<inputmode>"` focus a hidden input during the tap so the keyboard opens; the
 * page's `autoFocus` field then takes focus when it mounts, and the placeholder is removed once the
 * navigation has resolved.
 */
export function installKeyboardHandoff(router: AnyRouter): () => void {
  let placeholder: HTMLInputElement | null = null;
  const remove = () => {
    placeholder?.remove();
    placeholder = null;
  };

  const onClick = (event: MouseEvent) => {
    const link = (event.target as Element | null)?.closest?.("a[data-keyboard]");
    if (!(link instanceof HTMLAnchorElement) || !event.isTrusted) return;
    remove();
    placeholder = Object.assign(document.createElement("input"), {
      type: "text",
      inputMode: link.dataset.keyboard ?? "text",
      tabIndex: -1,
    });
    placeholder.setAttribute("aria-hidden", "true");
    placeholder.style.cssText =
      "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;border:0;padding:0;";
    document.documentElement.append(placeholder);
    placeholder.focus({ preventScroll: true });
  };

  document.addEventListener("click", onClick, true);
  const unsubscribe = router.subscribe("onResolved", () => requestAnimationFrame(remove));
  return () => {
    document.removeEventListener("click", onClick, true);
    unsubscribe();
    remove();
  };
}
