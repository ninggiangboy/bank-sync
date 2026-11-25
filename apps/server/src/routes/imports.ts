import { Elysia } from "elysia";
import type { AuthPlugin } from "../auth/plugin";
import type { createKvCache } from "../cache/kv-cache";
import { env } from "../config/env";
import type { Db } from "../db/client";
import { writeContext } from "../domain/demo";
import { HttpError } from "../http/errors";
import { importUpload } from "../inbound/import-upload";

export const IMPORT_MAX_PER_HOUR = 10;
const HOUR_SECONDS = 60 * 60;
/** Headroom for multipart framing around the files themselves. */
const FRAMING_BYTES = 1024 * 1024;

export const importRoutes = ({
  db,
  kv,
  authed,
}: {
  db: Db;
  kv: ReturnType<typeof createKvCache>;
  authed: AuthPlugin;
}) =>
  new Elysia().use(authed).post(
    "/imports",
    async ({ user, request }) => {
      writeContext(db, user);
      // Count first so parallel uploads each take a slot.
      if (kv.hit(`import:${user.id}`, HOUR_SECONDS) > IMPORT_MAX_PER_HOUR) {
        throw new HttpError(429, "too_many_attempts");
      }
      const declared = Number(request.headers.get("content-length") ?? 0);
      if (declared > env.UPLOAD_MAX_BYTES + FRAMING_BYTES) {
        throw new HttpError(413, "file_too_large");
      }
      const form = await request.formData().catch(() => null);
      const files = (form?.getAll("files") ?? []).flatMap((entry) =>
        typeof entry === "string" ? [] : [entry],
      );
      return importUpload(db, user.id, files, env.UPLOAD_MAX_BYTES);
    },
    { auth: true, parse: "none" },
  );
