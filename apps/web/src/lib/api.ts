import type { App } from "@bank-sync/server";
import { treaty } from "@elysiajs/eden";

/** Typed API client. Requests go to the same origin, so cookies stay first-party. */
export const api = treaty<App>(window.location.origin, {
  fetch: { credentials: "same-origin" },
}).api;
