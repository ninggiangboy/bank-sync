import { describe, expect, test } from "bun:test";
import { parseEnv } from "./env";

const strongSecret = "x".repeat(32);

describe("parseEnv", () => {
  test("applies defaults and treats empty values as unset", () => {
    const env = parseEnv({ PORT: "", MAIL_HOST: "" });
    expect(env.APP_NAME).toBe("Bank Sync");
    expect(env.PORT).toBe(8000);
    expect(env.MAIL_HOST).toBe("");
    expect(env.MAIL_FROM_NAME).toBe("Bank Sync");
    expect(env.WORKER_ENABLED).toBe(true);
    expect(env.SIMPLE_ANALYTICS_ENABLED).toBe(false);
  });

  test("generates distinct secrets outside production when unset", () => {
    const a = parseEnv({});
    const b = parseEnv({});
    expect(a.BETTER_AUTH_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(a.BETTER_AUTH_SECRET).not.toBe(b.BETTER_AUTH_SECRET);
  });

  test("parses booleans and numbers", () => {
    const env = parseEnv({ WORKER_ENABLED: "false", PORT: "9000", FX_USD_VND: "25500.5" });
    expect(env.WORKER_ENABLED).toBe(false);
    expect(env.PORT).toBe(9000);
    expect(env.FX_USD_VND).toBe(25500.5);
  });

  test("rejects short secrets and unknown time zones", () => {
    expect(() => parseEnv({ BETTER_AUTH_SECRET: "short" })).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => parseEnv({ APP_TIMEZONE: "Mars/Olympus" })).toThrow(/APP_TIMEZONE/);
  });

  test("requires secrets, inbound domain and source URL in production", () => {
    expect(() => parseEnv({ NODE_ENV: "production" })).toThrow(/required in production/);
    const env = parseEnv({
      NODE_ENV: "production",
      APP_SOURCE_URL: "https://example.com/source",
      INBOUND_DOMAIN: "in.example.com",
      INBOUND_WEBHOOK_SECRET: strongSecret,
      BETTER_AUTH_SECRET: strongSecret,
    });
    expect(env.INBOUND_DOMAIN).toBe("in.example.com");
  });
});
