import { describe, expect, test } from "bun:test";
import { parseEnv } from "./env";

const strongSecret = "x".repeat(32);
const dev = { NODE_ENV: "development" };
const production = {
  NODE_ENV: "production",
  APP_URL: "https://banksync.example.com",
  APP_SOURCE_URL: "https://example.com/source",
  INBOUND_DOMAIN: "in.example.com",
  INBOUND_WEBHOOK_SECRET: strongSecret,
  BETTER_AUTH_SECRET: strongSecret,
};

describe("parseEnv", () => {
  test("applies defaults and treats empty values as unset", () => {
    const env = parseEnv({ ...dev, PORT: "", MAIL_HOST: "" });
    expect(env.APP_NAME).toBe("Bank Sync");
    expect(env.PORT).toBe(8000);
    expect(env.MAIL_HOST).toBe("");
    expect(env.MAIL_FROM_NAME).toBe("Bank Sync");
    expect(env.WORKER_ENABLED).toBe(true);
    expect(env.SIMPLE_ANALYTICS_ENABLED).toBe(false);
  });

  test("generates distinct secrets outside production when unset", () => {
    const a = parseEnv(dev);
    const b = parseEnv(dev);
    expect(a.BETTER_AUTH_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(a.BETTER_AUTH_SECRET).not.toBe(b.BETTER_AUTH_SECRET);
  });

  test("parses booleans and numbers", () => {
    const env = parseEnv({ ...dev, WORKER_ENABLED: "false", PORT: "9000", FX_USD_VND: "25500.5" });
    expect(env.WORKER_ENABLED).toBe(false);
    expect(env.PORT).toBe(9000);
    expect(env.FX_USD_VND).toBe(25500.5);
  });

  test("rejects short secrets and unknown time zones", () => {
    expect(() => parseEnv({ ...dev, BETTER_AUTH_SECRET: "short" })).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => parseEnv({ ...dev, APP_TIMEZONE: "Mars/Olympus" })).toThrow(/APP_TIMEZONE/);
  });

  test("treats an unset NODE_ENV as production", () => {
    expect(() => parseEnv({})).toThrow(/required in production/);
    expect(parseEnv({ ...production, NODE_ENV: "" }).NODE_ENV).toBe("production");
  });

  test("requires app URL, secrets, inbound domain and source URL in production", () => {
    for (const key of Object.keys(production).filter((key) => key !== "NODE_ENV")) {
      expect(() => parseEnv({ ...production, [key]: "" })).toThrow(new RegExp(key));
    }
    expect(parseEnv(production).APP_URL).toBe("https://banksync.example.com");
  });
});
