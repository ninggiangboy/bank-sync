import { Elysia } from "elysia";
import type { AuthPlugin } from "../auth/plugin";
import type { createKvCache } from "../cache/kv-cache";
import type { Db } from "../db/client";
import { assertWritable, writeContext } from "../domain/demo";
import { filterXml, forwardingState } from "../domain/forwarding";
import { addressOf, rotateAddress } from "../domain/inbound-addresses";
import { HttpError } from "../http/errors";

export const ROTATE_MAX_PER_DAY = 5;
const DAY_SECONDS = 24 * 60 * 60;

export const forwardingRoutes = ({
  db,
  kv,
  authed,
}: {
  db: Db;
  kv: ReturnType<typeof createKvCache>;
  authed: AuthPlugin;
}) =>
  new Elysia({ prefix: "/forwarding" })
    .use(authed)
    // Reading creates the address on first use, which the demo account must never do.
    .get(
      "/",
      ({ user }) => {
        assertWritable(db, { actor: user, ownerId: user.id });
        return forwardingState(db, user.id);
      },
      { auth: true },
    )
    .post(
      "/rotate",
      ({ user }) => {
        writeContext(db, user);
        const key = `rotate-address:${user.id}`;
        if (kv.hit(key, DAY_SECONDS) > ROTATE_MAX_PER_DAY) {
          throw new HttpError(429, "too_many_attempts");
        }
        return { address: addressOf(rotateAddress(db, user.id).token) };
      },
      { auth: true },
    )
    .get(
      "/filter.xml",
      ({ user }) => {
        assertWritable(db, { actor: user, ownerId: user.id });
        return new Response(filterXml(db, user.id), {
          headers: {
            "content-type": "application/xml; charset=utf-8",
            "content-disposition": 'attachment; filename="bank-sync-filter.xml"',
            "cache-control": "no-store",
          },
        });
      },
      { auth: true },
    );
