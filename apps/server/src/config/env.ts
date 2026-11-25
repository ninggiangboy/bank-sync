import { z } from "zod";

const isTimeZone = (value: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

const flag = (fallback: boolean) => z.stringbool().default(fallback);
const positiveInt = (fallback: number) => z.coerce.number().int().positive().default(fallback);
const secret = z.string().min(32, "must be at least 32 characters").optional();

const schema = z.object({
  // Fail closed: anything not explicitly development or test runs with production rules.
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
  APP_NAME: z.string().min(1).default("Bank Sync"),
  APP_URL: z.url().default("http://localhost:8000"),
  APP_TIMEZONE: z.string().refine(isTimeZone, "unknown time zone").default("Asia/Ho_Chi_Minh"),
  APP_LOCALE: z.enum(["vi", "en"]).default("vi"),
  APP_SOURCE_URL: z.url().optional(),
  DATABASE_PATH: z.string().min(1).default("storage/bank-sync.sqlite"),
  PORT: positiveInt(8000),

  // Outgoing mail for verification and password reset. An empty host logs mail instead.
  MAIL_HOST: z.string().default(""),
  MAIL_PORT: positiveInt(587),
  MAIL_USERNAME: z.string().default(""),
  MAIL_PASSWORD: z.string().default(""),
  MAIL_FROM_ADDRESS: z.email().default("hello@example.com"),
  MAIL_FROM_NAME: z.string().optional(),

  INBOUND_DOMAIN: z.string().min(1).optional(),
  INBOUND_WEBHOOK_SECRET: secret,
  INBOUND_MAX_BYTES: positiveInt(2 * 1024 * 1024),
  UPLOAD_MAX_BYTES: positiveInt(50 * 1024 * 1024),

  FX_USD_VND: z.coerce.number().positive().default(26000),
  DEMO_USER_EMAIL: z.email().default("demo@example.com"),
  SIMPLE_ANALYTICS_ENABLED: flag(false),
  BETTER_AUTH_SECRET: secret,
  WORKER_ENABLED: flag(true),
  SCHEDULER_ENABLED: flag(true),
});

/** Must be set explicitly in production; their development fallbacks would be wrong or insecure. */
const PRODUCTION_REQUIRED = [
  "APP_URL",
  "APP_SOURCE_URL",
  "INBOUND_DOMAIN",
  "INBOUND_WEBHOOK_SECRET",
  "BETTER_AUTH_SECRET",
] as const;

const randomSecret = () =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

/**
 * Parses and validates environment variables. Empty values count as unset, and an unset
 * NODE_ENV means production. Outside production, missing secrets get a random per-process value, so
 * sessions and webhook signatures reset on restart but no secret is ever hard-coded.
 */
export function parseEnv(source: Record<string, string | undefined>) {
  const present = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ""));
  const result = schema.safeParse(present);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  const env = result.data;
  if (env.NODE_ENV === "production") {
    const missing = PRODUCTION_REQUIRED.filter((key) => present[key] === undefined);
    if (missing.length > 0) {
      const lines = missing.map((key) => `✖ ${key}: required in production`);
      throw new Error(`Invalid environment:\n${lines.join("\n")}`);
    }
  }
  return {
    ...env,
    APP_SOURCE_URL: env.APP_SOURCE_URL ?? "https://github.com/ninggiangboy/bank-sync",
    MAIL_FROM_NAME: env.MAIL_FROM_NAME ?? env.APP_NAME,
    INBOUND_DOMAIN: env.INBOUND_DOMAIN ?? "inbound.localhost",
    INBOUND_WEBHOOK_SECRET: env.INBOUND_WEBHOOK_SECRET ?? randomSecret(),
    BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET ?? randomSecret(),
  };
}

export type Env = ReturnType<typeof parseEnv>;

export const env: Env = parseEnv(process.env);
