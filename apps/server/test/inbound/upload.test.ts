import { describe, expect, test } from "bun:test";
import { count } from "drizzle-orm";
import { rawEmails } from "../../src/db/schema";
import { importUpload, splitMbox, type UploadFile } from "../../src/inbound/import-upload";
import { allTransactions, createPipeline, fixture } from "../helpers";

const file = (name: string, bytes: Uint8Array): UploadFile => ({
  name,
  size: bytes.byteLength,
  stream: () => new Blob([bytes as BlobPart]).stream(),
});

const text = (value: string) => new TextEncoder().encode(value);
const asString = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

function mbox(...messages: Uint8Array[]): Uint8Array {
  const parts = messages.flatMap((message) => [
    Buffer.from("From MAILER-DAEMON Thu Nov 12 00:00:00 2026\n"),
    Buffer.from(message),
    Buffer.from("\n"),
  ]);
  return new Uint8Array(Buffer.concat(parts));
}

const NON_BANK = text(
  "From: Friend <friend@example.com>\nSubject: hi\nMessage-ID: <friend-1@example.com>\n\nHello\n>From the past\n",
);

describe("splitMbox", () => {
  async function collect(bytes: Uint8Array) {
    const out: string[] = [];
    for await (const message of splitMbox(new Blob([bytes as BlobPart]).stream()))
      out.push(asString(message));
    return out;
  }

  test("splits on From lines and unescapes mboxrd quoting", async () => {
    const parts = await collect(
      text("From a\nSubject: 1\n\n>From inside\n>>From deeper\n\nFrom b\nSubject: 2\n\nbody\n"),
    );
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain("\nFrom inside\n");
    expect(parts[0]).toContain("\n>From deeper\n");
    expect(parts[1]).toContain("Subject: 2");
  });

  test("handles a file with no trailing newline and ignores text before the first separator", async () => {
    const parts = await collect(text("junk\nFrom a\nSubject: 1\n\nlast line"));
    expect(parts).toEqual(["Subject: 1\n\nlast line"]);
  });

  test("keeps 8-bit bytes intact across chunk boundaries", async () => {
    const bytes = new Uint8Array([...text("From a\nX: "), 0xc3, 0xa9, ...text("\n")]);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    });
    const [message] = await Array.fromAsync(splitMbox(stream));
    expect(Array.from(message ?? [])).toEqual([...text("X: "), 0xc3, 0xa9]);
  });
});

describe("importUpload", () => {
  test("an mbox keeps bank emails, skips others, and a second upload is all duplicates", async () => {
    const { db, userId, worker } = createPipeline();
    const upload = file(
      "mail.mbox",
      mbox(
        fixture("VCB/02_salary_in"),
        NON_BANK,
        fixture("CAKE/01_transfer_in"),
        fixture("VPB/01_qr_payment"),
      ),
    );

    expect(await importUpload(db, userId, [upload], 1e9)).toEqual({
      imported: 3,
      duplicates: 0,
      skipped: 1,
    });
    expect(await importUpload(db, userId, [upload], 1e9)).toEqual({
      imported: 0,
      duplicates: 3,
      skipped: 1,
    });

    await worker.drain();
    expect(allTransactions(db)).toHaveLength(3);
    const rows = db.select().from(rawEmails).all();
    expect(rows.every((row) => row.source === "upload" && row.verification === "user_upload")).toBe(
      true,
    );
  });

  test("the same message forwarded and uploaded makes one transaction", async () => {
    const { db, userId, worker, address } = createPipeline();
    const { createInboxFiles } = await import("../../src/inbound/inbox-files");
    const { ingestEmail } = await import("../../src/jobs/ingest-email");
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const files = createInboxFiles(mkdtempSync(join(tmpdir(), "inbox-")));
    files.write("a.eml", fixture("VCB/02_salary_in"));
    await ingestEmail({ db, files }, { file: "a.eml", inboundAddressId: address.id });

    const result = await importUpload(
      db,
      userId,
      [file("one.eml", fixture("VCB/02_salary_in"))],
      1e9,
    );
    expect(result).toEqual({ imported: 0, duplicates: 1, skipped: 0 });
    await worker.drain();
    expect(allTransactions(db)).toHaveLength(1);
  });

  test("several .eml files import, and non-bank ones are skipped", async () => {
    const { db, userId, worker } = createPipeline();
    const result = await importUpload(
      db,
      userId,
      [
        file("a.eml", fixture("CAKE/02_transfer_out")),
        file("b.eml", NON_BANK),
        file("c.EML", fixture("VPB/01_qr_payment")),
      ],
      1e9,
    );
    expect(result).toEqual({ imported: 2, duplicates: 0, skipped: 1 });
    await worker.drain();
    expect(allTransactions(db)).toHaveLength(2);
  });

  test("rejects other file types, mixed mbox uploads and oversized uploads", async () => {
    const { db, userId } = createPipeline();
    const reject = async (files: UploadFile[], max = 1e9) => {
      try {
        await importUpload(db, userId, files, max);
      } catch (error) {
        return (error as { status: number; code: string }).code;
      }
      return "accepted";
    };
    expect(await reject([file("notes.txt", text("x"))])).toBe("unsupported_file");
    expect(await reject([])).toBe("unsupported_file");
    expect(await reject([file("a.mbox", mbox(NON_BANK)), file("b.eml", NON_BANK)])).toBe(
      "unsupported_file",
    );
    expect(await reject([file("a.eml", fixture("VCB/02_salary_in"))], 10)).toBe("file_too_large");
    expect(db.select({ n: count() }).from(rawEmails).get()?.n).toBe(0);
  });
});
