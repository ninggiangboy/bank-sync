import { db } from "../db";
import { createMailer } from "../mail/mailer";
import { createAuth } from "./create-auth";

/**
 * The configured instance for tooling only (`auth generate` reads this file). The server builds its
 * own through `createApp`, so importing the app never opens the real database.
 */
export const auth = createAuth({ db, mailer: createMailer() });
