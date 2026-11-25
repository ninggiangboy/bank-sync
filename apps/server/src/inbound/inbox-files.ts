import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

/** Pending inbound messages, kept on disk only until the ingest job has handled them. */
export function createInboxFiles(directory: string) {
  return {
    write(name: string, bytes: Uint8Array) {
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, name), bytes);
    },
    read(name: string): Uint8Array | null {
      const path = join(directory, name);
      return existsSync(path) ? new Uint8Array(readFileSync(path)) : null;
    },
    remove(name: string) {
      rmSync(join(directory, name), { force: true });
    },
    /** Deletes files older than `olderThanMs`. Returns how many. */
    purgeOlderThan(olderThanMs: number, now = Date.now()): number {
      if (!existsSync(directory)) return 0;
      let removed = 0;
      for (const name of readdirSync(directory)) {
        const path = join(directory, name);
        if (now - statSync(path).mtimeMs > olderThanMs) {
          rmSync(path, { force: true });
          removed++;
        }
      }
      return removed;
    },
  };
}

export type InboxFiles = ReturnType<typeof createInboxFiles>;
