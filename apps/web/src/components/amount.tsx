import { foreign, money, signedAmount } from "../lib/format";

type AmountProps = {
  transaction: {
    direction: "in" | "out";
    amount: number;
    amountEstimated: boolean;
    currency: string | null;
    originalAmount: number | null;
  };
  className?: string;
};

/** Signed VND amount, green for money in, with the foreign original below when there is one. */
export function Amount({ transaction, className = "" }: AmountProps) {
  return (
    <span
      className={`font-num font-semibold whitespace-nowrap ${transaction.direction === "in" ? "text-emerald-600" : ""} ${className}`}
    >
      {transaction.amountEstimated ? "≈ " : ""}
      {money(signedAmount(transaction), true)}
      {transaction.currency && transaction.originalAmount !== null ? (
        <span className="block text-xs font-normal text-slate-500">
          {foreign(transaction.originalAmount, transaction.currency)}
        </span>
      ) : null}
    </span>
  );
}
