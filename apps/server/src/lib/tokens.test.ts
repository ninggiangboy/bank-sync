import { expect, test } from "bun:test";
import { newInboundToken } from "./tokens";

test("inbound tokens are 26 lowercase base32 characters and unique across 10k draws", () => {
  const tokens = new Set<string>();
  for (let i = 0; i < 10_000; i++) {
    const token = newInboundToken();
    expect(token).toMatch(/^[a-z2-7]{26}$/);
    tokens.add(token);
  }
  expect(tokens.size).toBe(10_000);
});
