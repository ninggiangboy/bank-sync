import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { env } from "../config/env";
import { db } from "../db";
import * as schema from "../db/schema";

export const auth = betterAuth({
  appName: env.APP_NAME,
  baseURL: env.APP_URL,
  basePath: "/api/auth",
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "sqlite", schema }),
  emailAndPassword: { enabled: true },
  user: {
    additionalFields: {
      viewingDemo: { type: "boolean", required: true, defaultValue: false, input: false },
    },
  },
});
