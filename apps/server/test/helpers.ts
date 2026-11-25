import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dkimSign } from "mailauth";
import { transactions } from "../src/db/schema";
import { seedSystemCategories } from "../src/db/seed/system-categories";
import { createTestDb, createTestUser } from "../src/db/test-db";
import { getOrCreateActiveAddress } from "../src/domain/inbound-addresses";
import { createInboxFiles } from "../src/inbound/inbox-files";
import { createJobHandlers } from "../src/jobs";
import { createWorker } from "../src/queue/worker";

export const FIXTURES = join(import.meta.dir, "fixtures/emails");

export const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(FIXTURES, `${name}.eml`)));

export function fixtureNames(): string[] {
  return readdirSync(FIXTURES).flatMap((bank) =>
    readdirSync(join(FIXTURES, bank))
      .filter((file) => file.endsWith(".eml"))
      .map((file) => `${bank}/${file.replace(/\.eml$/, "")}`),
  );
}

type Transaction = typeof transactions.$inferSelect;

/** A database with system categories, one user with an inbound address, an inbox directory and a worker. */
export function createPipeline(resolver?: (name: string, rrtype: string) => Promise<unknown>) {
  const db = createTestDb();
  seedSystemCategories(db);
  const userId = createTestUser(db);
  const address = getOrCreateActiveAddress(db, userId);
  const files = createInboxFiles(mkdtempSync(join(tmpdir(), "inbox-")));
  const worker = createWorker({
    db,
    handlers: createJobHandlers({ db, files, ...(resolver ? { resolver } : {}) }),
    log: () => {},
    backoffMs: () => 0,
  });
  return { db, userId, address, files, worker };
}

export const allTransactions = (db: ReturnType<typeof createTestDb>): Transaction[] =>
  db.select().from(transactions).all();

/** A DKIM key pair plus a DNS resolver that serves its public half for `selector._domainkey.domain`. */
export function createDkimKey(domain: string, selector = "s1") {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const spki = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const records = new Map([[`${selector}._domainkey.${domain}`, `v=DKIM1; k=rsa; p=${spki}`]]);

  return {
    resolver: async (name: string, rrtype: string) => {
      const record = records.get(name.toLowerCase());
      if (rrtype === "TXT" && record) return [[record]];
      throw Object.assign(new Error(`ENOTFOUND ${name}`), { code: "ENOTFOUND" });
    },
    async sign(
      message: Uint8Array,
      options: { signingDomain?: string; bodyLength?: boolean } = {},
    ) {
      const signingDomain = options.signingDomain ?? domain;
      const result = await dkimSign(Buffer.from(message), {
        canonicalization: "relaxed/relaxed",
        signatureData: [
          {
            signingDomain,
            selector,
            privateKey: pem,
            algorithm: "rsa-sha256",
            canonicalization: "relaxed/relaxed",
            ...(options.bodyLength ? { maxBodyLength: 20 } : {}),
          },
        ],
      } as never);
      return new Uint8Array(Buffer.concat([Buffer.from(result.signatures), Buffer.from(message)]));
    },
  };
}
