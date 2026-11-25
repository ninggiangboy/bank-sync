import { db } from "../db";
import { migrateDatabase } from "../db/migrate";
import { runCli } from "./commands";

migrateDatabase(db);
const code = await runCli(process.argv.slice(2), {
  db,
  out: (line) => console.log(line),
  err: (line) => console.error(line),
});
process.exit(code);
