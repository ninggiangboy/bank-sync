import { describe, expect, test } from "bun:test";
import { createHash, createHmac } from "node:crypto";
import { signInbound } from "../../server/src/inbound/route";
import { render } from "../scripts/generate-senders";
import { type Env, handleEmail, type InboundMessage } from "../src/index";

const ENV: Env = {
  INBOUND_URL: "https://bank.example/api/inbound/email",
  INBOUND_WEBHOOK_SECRET: "s".repeat(40),
  INBOUND_MAX_BYTES: "1000",
};
const NOW = 1_795_600_000_000;

function message(
  overrides: { from?: string; headerFrom?: string; raw?: string; rawSize?: number } = {},
) {
  const rejected: string[] = [];
  const raw = new TextEncoder().encode(overrides.raw ?? "Subject: hi\r\n\r\nbody");
  const value: InboundMessage = {
    from: overrides.from ?? "bounce@somewhere.example",
    to: "abc@in.example.com",
    headers: new Headers({
      from: overrides.headerFrom ?? "Vietcombank <VCBDigibank@info.vietcombank.com.vn>",
    }),
    raw: new Blob([raw]).stream(),
    rawSize: overrides.rawSize ?? raw.byteLength,
    setReject: (reason) => void rejected.push(reason),
  };
  return { value, rejected, raw };
}

function sender(status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const send = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(null, { status });
  }) as unknown as typeof fetch;
  return { send, calls };
}

describe("inbound worker", () => {
  test("a bank sender is forwarded with a signature the server accepts", async () => {
    const { value, raw } = message();
    const { send, calls } = sender();
    await handleEmail(value, ENV, send, () => NOW);

    expect(calls).toHaveLength(1);
    const [{ url, init }] = calls as [(typeof calls)[number]];
    const headers = init.headers as Record<string, string>;
    const timestamp = String(Math.floor(NOW / 1000));
    expect(url).toBe(ENV.INBOUND_URL);
    expect(init.method).toBe("POST");
    expect(headers["x-inbound-recipient"]).toBe("abc@in.example.com");
    expect(headers["x-inbound-timestamp"]).toBe(timestamp);
    expect(headers["x-inbound-signature"]).toBe(
      signInbound(ENV.INBOUND_WEBHOOK_SECRET, timestamp, "abc@in.example.com", raw),
    );
    // The same signature, computed from the documented formula.
    const bodyHash = createHash("sha256").update(raw).digest("hex");
    expect(headers["x-inbound-signature"]).toBe(
      createHmac("sha256", ENV.INBOUND_WEBHOOK_SECRET)
        .update(`${timestamp}.abc@in.example.com.${bodyHash}`)
        .digest("hex"),
    );
    expect(new Uint8Array(init.body as Uint8Array)).toEqual(raw);
  });

  test("the envelope sender alone is enough, and Gmail's confirmation mail passes", async () => {
    const { send, calls } = sender();
    await handleEmail(
      message({ from: "no-reply@cake.vn", headerFrom: "x@example.com" }).value,
      ENV,
      send,
    );
    await handleEmail(
      message({ headerFrom: "Gmail Team <forwarding-noreply@google.com>" }).value,
      ENV,
      send,
    );
    expect(calls).toHaveLength(2);
  });

  test("a non-bank sender is dropped without a fetch or a bounce", async () => {
    const { value, rejected } = message({ headerFrom: "friend@example.com" });
    const { send, calls } = sender();
    await handleEmail(value, ENV, send);
    expect(calls).toHaveLength(0);
    expect(rejected).toHaveLength(0);
  });

  test("a lookalike domain is not a bank sender", async () => {
    const { send, calls } = sender();
    await handleEmail(message({ headerFrom: "scam@vietcombank.com.vn.evil.io" }).value, ENV, send);
    expect(calls).toHaveLength(0);
  });

  test("a 404 rejects the message as unknown", async () => {
    const { value, rejected } = message();
    await handleEmail(value, ENV, sender(404).send);
    expect(rejected).toEqual(["Unknown address"]);
  });

  test("a server error throws so Cloudflare reports a failure", async () => {
    await expect(handleEmail(message().value, ENV, sender(503).send)).rejects.toThrow("HTTP 503");
    await expect(handleEmail(message().value, ENV, sender(401).send)).rejects.toThrow("HTTP 401");
  });

  test("a network error throws", async () => {
    const failing = (async () => {
      throw new TypeError("connection refused");
    }) as unknown as typeof fetch;
    await expect(handleEmail(message().value, ENV, failing)).rejects.toThrow("connection refused");
  });

  test("a message over the size cap is rejected and not forwarded", async () => {
    const { send, calls } = sender();
    const declared = message({ rawSize: 5000 });
    await handleEmail(declared.value, ENV, send);
    const streamed = message({ raw: "x".repeat(2000), rawSize: 10 });
    await handleEmail(streamed.value, ENV, send);
    expect(calls).toHaveLength(0);
    expect(declared.rejected).toEqual(["Message too large"]);
    expect(streamed.rejected).toEqual(["Message too large"]);
  });

  test("nothing is logged", async () => {
    const logged: unknown[] = [];
    const originals = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
    };
    for (const name of Object.keys(originals) as (keyof typeof originals)[]) {
      console[name] = (...args: unknown[]) => void logged.push(args);
    }
    try {
      await handleEmail(message().value, ENV, sender().send);
      await handleEmail(message({ headerFrom: "friend@example.com" }).value, ENV, sender().send);
    } finally {
      Object.assign(console, originals);
    }
    expect(logged).toHaveLength(0);
  });

  test("the generated sender list matches the server's bank configuration", async () => {
    const file = await Bun.file(new URL("../src/senders.generated.ts", import.meta.url)).text();
    expect(file).toBe(render());
  });
});
