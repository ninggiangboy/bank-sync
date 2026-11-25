import { Elysia } from "elysia";

/** Logs method, path, status and duration of each request. Never logs bodies or query strings. */
export const requestLogger = () => {
  const startedAt = new WeakMap<Request, number>();
  return new Elysia({ name: "request-logger" })
    .onRequest(({ request }) => {
      startedAt.set(request, performance.now());
    })
    .onAfterResponse({ as: "global" }, ({ request, path, set }) => {
      const start = startedAt.get(request);
      const ms = start === undefined ? 0 : performance.now() - start;
      console.info(`${request.method} ${path} ${set.status ?? 200} ${ms.toFixed(1)}ms`);
    });
};
