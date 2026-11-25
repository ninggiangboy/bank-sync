import type { Db } from "../db/client";
import type { DnsResolver } from "../inbound/dkim";
import type { InboxFiles } from "../inbound/inbox-files";
import type { JobHandlers } from "../queue/worker";
import { type IngestEmailPayload, ingestEmail } from "./ingest-email";
import { type ParseRawEmailPayload, parseRawEmail } from "./parse-raw-email";

export type JobDeps = { db: Db; files: InboxFiles; resolver?: DnsResolver };

/** Every job the worker can run, keyed by the name used with `dispatch`. */
export function createJobHandlers({ db, files, resolver }: JobDeps): JobHandlers {
  return {
    "parse-raw-email": (payload: ParseRawEmailPayload) => parseRawEmail(db, payload),
    "ingest-email": (payload: IngestEmailPayload) =>
      ingestEmail(resolver ? { db, files, resolver } : { db, files }, payload),
  };
}
