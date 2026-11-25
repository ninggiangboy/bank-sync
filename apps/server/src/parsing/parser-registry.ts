import { senderAddress } from "./abstract-bank-parser";
import { BANKS } from "./banks-config";
import type { BankEmailParser } from "./types";

export { senderAddress };

export function allParsers(): BankEmailParser[] {
  return Object.values(BANKS).map((bank) => bank.parser);
}

/** Every configured sender address, deduplicated. */
export function bankSenders(): string[] {
  return [...new Set(Object.values(BANKS).flatMap((bank) => bank.senders))];
}

export function findParser(from: string, subject: string): BankEmailParser | null {
  const address = senderAddress(from);
  return allParsers().find((parser) => parser.supports(address, subject)) ?? null;
}
