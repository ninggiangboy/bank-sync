import type { Db } from "../db/client";
import { storeEmail } from "../domain/raw-emails";
import { HttpError } from "../http/errors";
import { fromEml } from "../mail/fetched-message";
import { findParser } from "../parsing/parser-registry";

export type UploadFile = { name: string; size: number; stream(): ReadableStream<Uint8Array> };
export type ImportResult = { imported: number; duplicates: number; skipped: number };

/**
 * Splits an mboxrd stream into messages. A line starting with "From " opens a message; inside a
 * message, lines that were escaped as ">From " (any number of ">") lose one ">". Bytes are kept
 * intact by reading as latin1.
 */
export async function* splitMbox(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const decoder = new TextDecoder("latin1");
  let pending = "";
  let lines: string[] | null = null;

  const finish = () => (lines ? new Uint8Array(Buffer.from(lines.join("\n"), "latin1")) : null);
  function* take(line: string): Generator<Uint8Array> {
    if (line.startsWith("From ")) {
      const done = finish();
      lines = [];
      if (done) yield done;
    } else if (lines) {
      lines.push(/^>+From /.test(line) ? line.slice(1) : line);
    }
  }

  for await (const chunk of stream) {
    pending += decoder.decode(chunk, { stream: true });
    const parts = pending.split("\n");
    pending = parts.pop() ?? "";
    for (const line of parts) yield* take(line);
  }
  pending += decoder.decode();
  if (pending !== "") yield* take(pending);
  const last = finish();
  if (last) yield last;
}

async function* messagesOf(file: UploadFile): AsyncGenerator<Uint8Array> {
  if (file.name.toLowerCase().endsWith(".mbox")) {
    yield* splitMbox(file.stream());
    return;
  }
  yield new Uint8Array(await new Response(file.stream()).arrayBuffer());
}

/**
 * Imports `.eml` files or one `.mbox` file into the user's mail. Only bank senders are kept, and
 * no DKIM check applies: an uploader can only affect their own data, and old signing keys rotate.
 */
export async function importUpload(
  db: Db,
  userId: string,
  files: UploadFile[],
  maxBytes: number,
): Promise<ImportResult> {
  const supported = files.every((file) => /\.(eml|mbox)$/i.test(file.name));
  if (files.length === 0 || !supported) throw new HttpError(422, "unsupported_file");
  if (files.some((file) => /\.mbox$/i.test(file.name)) && files.length > 1) {
    throw new HttpError(422, "unsupported_file");
  }
  if (files.reduce((sum, file) => sum + file.size, 0) > maxBytes) {
    throw new HttpError(413, "file_too_large");
  }

  const result: ImportResult = { imported: 0, duplicates: 0, skipped: 0 };
  for (const file of files) {
    for await (const raw of messagesOf(file)) {
      const message = await fromEml(raw).catch(() => null);
      if (!message || !findParser(message.from, message.subject)) {
        result.skipped++;
        continue;
      }
      const { created } = storeEmail(db, {
        userId,
        source: "upload",
        verification: "user_upload",
        message,
      });
      if (created) result.imported++;
      else result.duplicates++;
    }
  }
  return result;
}
