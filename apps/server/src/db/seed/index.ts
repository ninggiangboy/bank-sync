import { db } from "../index";
import { seedSystemCategories } from "./system-categories";

const created = seedSystemCategories(db);
console.info(`System categories: ${created} created.`);
