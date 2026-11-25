import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { and, count, eq, gt, isNotNull, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { rawEmails, user } from "../db/schema";
import { addressOf, getOrCreateActiveAddress } from "../domain/inbound-addresses";
import { storeEmail } from "../domain/raw-emails";
import { parseRawEmail } from "../jobs/parse-raw-email";
import { refreshDemo } from "../jobs/refresh-demo";
import { updateExchangeRates } from "../jobs/update-exchange-rates";
import { fromEml } from "../mail/fetched-message";
import { findParser } from "../parsing/parser-registry";
import { cancelPending } from "../queue/queue";

export type CliContext = {
  db: Db;
  out: (line: string) => void;
  err: (line: string) => void;
  fetcher?: typeof fetch;
};

export type ParsedArgs = { positional: string[]; flags: Record<string, string | true> };

/** `--failed`, `--bank=VCB` and `--bank VCB` forms; everything else is positional. */
export function parseArgs(argv: string[], valueFlags: string[] = []): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const [name = "", inline] = arg.slice(2).split("=", 2);
    if (inline !== undefined) flags[name] = inline;
    else if (valueFlags.includes(name)) flags[name] = argv[++i] ?? "";
    else flags[name] = true;
  }
  return { positional, flags };
}

const randomSecret = () =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

function findUser(db: Db, idOrEmail: string) {
  return db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(or(eq(user.email, idOrEmail.toLowerCase()), eq(user.id, idOrEmail)))
    .get();
}

function emlFiles(path: string): string[] {
  const stat = statSync(path, { throwIfNoEntry: false });
  if (!stat) return [];
  if (stat.isFile()) return [path];
  return readdirSync(path, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".eml")
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

type Command = (ctx: CliContext, args: ParsedArgs) => Promise<number> | number;

export const COMMANDS: Record<string, { usage: string; valueFlags?: string[]; run: Command }> = {
  reparse: {
    usage: "reparse [--failed] [--bank=CODE]",
    valueFlags: ["bank"],
    run({ db, out }, { flags }) {
      const conditions = [
        flags.failed ? isNotNull(rawEmails.parseError) : undefined,
        typeof flags.bank === "string"
          ? eq(rawEmails.bankCode, flags.bank.toUpperCase())
          : undefined,
      ].filter((c) => c !== undefined);
      const where = conditions.length > 0 ? and(...conditions) : undefined;
      let total = 0;
      let failed = 0;
      for (let lastId = 0; ; ) {
        const batch = db
          .select({ id: rawEmails.id })
          .from(rawEmails)
          .where(where ? and(where, gt(rawEmails.id, lastId)) : gt(rawEmails.id, lastId))
          .orderBy(rawEmails.id)
          .limit(200)
          .all();
        if (batch.length === 0) break;
        for (const { id } of batch) {
          lastId = id;
          total++;
          parseRawEmail(db, { rawEmailId: id });
          const error = db
            .select({ e: rawEmails.parseError })
            .from(rawEmails)
            .where(eq(rawEmails.id, id))
            .get()?.e;
          if (error) {
            failed++;
            out(`raw email ${id}: ${error}`);
          }
        }
      }
      out(`Reparsed ${total} emails, ${failed} failed.`);
      return 0;
    },
  },

  "import-eml": {
    usage: "import-eml <user id or email> <path to .eml file or folder>",
    async run({ db, out, err }, { positional }) {
      const [who, path] = positional;
      if (!who || !path) {
        err("Usage: import-eml <user> <path>");
        return 2;
      }
      const owner = findUser(db, who);
      if (!owner) {
        err("User not found.");
        return 1;
      }
      const files = emlFiles(path);
      if (files.length === 0) {
        err(`No .eml files found at ${path}.`);
        return 1;
      }
      let imported = 0;
      for (const file of files) {
        const message = await fromEml(new Uint8Array(readFileSync(file)));
        if (!findParser(message.from, message.subject)) {
          out(`${file}: skipped, sender is not a supported bank`);
          continue;
        }
        const { row, created } = storeEmail(db, {
          userId: owner.id,
          source: "upload",
          verification: "user_upload",
          message,
        });
        if (!created) {
          out(`${file}: skipped, already imported`);
          continue;
        }
        parseRawEmail(db, { rawEmailId: row.id });
        cancelPending(db, `parse-raw-email:${row.id}`);
        imported++;
        const error = db
          .select({ e: rawEmails.parseError })
          .from(rawEmails)
          .where(eq(rawEmails.id, row.id))
          .get()?.e;
        out(error ? `${file}: failed, ${error}` : `${file}: parsed`);
      }
      out(`Imported ${imported} of ${files.length} files.`);
      return 0;
    },
  },

  "refresh-demo": {
    usage: "refresh-demo",
    run({ db, out }) {
      const { days, moved } = refreshDemo(db);
      out(
        days === 0
          ? "Demo data is already up to date."
          : `Moved ${moved} demo transactions by ${days} days.`,
      );
      return 0;
    },
  },

  "parse-stats": {
    usage: "parse-stats",
    run({ db, out }) {
      const rows = db
        .select({
          bank: rawEmails.bankCode,
          total: count(),
          parsed: sql<number>`sum(case when ${rawEmails.parsedAt} is not null then 1 else 0 end)`,
          failed: sql<number>`sum(case when ${rawEmails.parseError} is not null then 1 else 0 end)`,
        })
        .from(rawEmails)
        .groupBy(rawEmails.bankCode)
        .orderBy(rawEmails.bankCode)
        .all();
      if (rows.length === 0) {
        out("No raw emails yet.");
        return 0;
      }
      out("Bank\tTotal\tParsed\tFailed\tSuccess");
      for (const row of rows) {
        const rate = Math.round((1000 * Number(row.parsed)) / Math.max(1, row.total)) / 10;
        out(
          `${row.bank ?? "-"}\t${row.total}\t${Number(row.parsed)}\t${Number(row.failed)}\t${rate}%`,
        );
      }
      return 0;
    },
  },

  "update-exchange-rates": {
    usage: "update-exchange-rates",
    async run({ db, out, err, fetcher }) {
      try {
        const { currencies, requeued } = await updateExchangeRates(db, fetcher);
        out(
          `Saved rates for ${currencies} currencies. Queued ${requeued} emails that failed for a missing rate.`,
        );
        return 0;
      } catch {
        err("Could not download exchange rates; keeping the previous ones.");
        return 1;
      }
    },
  },

  "inbound-address": {
    usage: "inbound-address <user id or email>",
    run({ db, out, err }, { positional }) {
      const owner = positional[0] ? findUser(db, positional[0]) : undefined;
      if (!owner) {
        err("User not found.");
        return 1;
      }
      out(addressOf(getOrCreateActiveAddress(db, owner.id).token));
      return 0;
    },
  },

  "key:generate": {
    usage: "key:generate",
    run({ out }) {
      out(`BETTER_AUTH_SECRET=${randomSecret()}`);
      out(`INBOUND_WEBHOOK_SECRET=${randomSecret()}`);
      return 0;
    },
  },
};

export async function runCli(argv: string[], ctx: CliContext): Promise<number> {
  const [name, ...rest] = argv;
  const command = name ? COMMANDS[name] : undefined;
  if (!command) {
    ctx.err(
      `Usage: bun apps/server/src/cli/index.ts <command>\n\n${Object.values(COMMANDS)
        .map((c) => `  ${c.usage}`)
        .join("\n")}`,
    );
    return name ? 2 : 0;
  }
  return command.run(ctx, parseArgs(rest, command.valueFlags));
}
