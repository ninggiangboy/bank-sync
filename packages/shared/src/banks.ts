/** Supported bank code to display name. Keep in sync with apps/server/src/parsing/banks-config.ts. */
export const BANK_NAMES = {
  VCB: "Vietcombank",
  CAKE: "CAKE by VPBank",
  VPB: "VPBank",
} as const;

export type BankCode = keyof typeof BANK_NAMES;
