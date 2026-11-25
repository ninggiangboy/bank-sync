import type { AbstractBankParser } from "./abstract-bank-parser";
import { CakeParser } from "./banks/cake-parser";
import { VietcombankParser } from "./banks/vietcombank-parser";
import { VpBankParser } from "./banks/vpbank-parser";
import type { Direction } from "./types";

export type BankConfig = {
  name: string;
  /** Lowercase sender addresses. Only mail from these is ever stored. */
  senders: readonly string[];
  /** Which directions the bank emails about. */
  directions: readonly Direction[];
  parser: AbstractBankParser;
};

const senders = {
  VCB: [
    "vcbdigibank@info.vietcombank.com.vn", // verified with real receipts
    "info@info.vietcombank.com.vn", // verified with a real card alert
  ],
  CAKE: ["no-reply@cake.vn"], // verified with real transfer alerts
  VPB: ["vpbankonline@vpb.com.vn"], // verified with a real transfer confirmation
} as const;

export const BANKS = {
  VCB: {
    name: "Vietcombank",
    senders: senders.VCB,
    directions: ["out"],
    parser: new VietcombankParser(senders.VCB),
  },
  CAKE: {
    name: "CAKE by VPBank",
    senders: senders.CAKE,
    directions: ["in", "out"],
    parser: new CakeParser(senders.CAKE),
  },
  VPB: {
    name: "VPBank",
    senders: senders.VPB,
    directions: ["out"],
    parser: new VpBankParser(senders.VPB),
  },
} as const satisfies Record<string, BankConfig>;

export type BankCode = keyof typeof BANKS;
