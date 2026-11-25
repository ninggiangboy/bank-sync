import { db } from "../index";
import { seedDemo } from "./demo";
import { seedSystemCategories } from "./system-categories";

const created = seedSystemCategories(db);
console.info(`System categories: ${created} created.`);

if (process.argv.includes("--demo")) {
  const { ledgerRows } = await seedDemo(db, { log: console.info });
  console.info(`Demo account recreated with ${ledgerRows} generated transactions.`);
}
