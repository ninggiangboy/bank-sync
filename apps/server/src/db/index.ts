import { env } from "../config/env";
import { openDatabase } from "./client";

/** The application database. Tests open their own with `openDatabase(":memory:")`. */
export const db = openDatabase(env.DATABASE_PATH);
