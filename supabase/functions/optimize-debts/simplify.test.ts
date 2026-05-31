// Run with:  deno test supabase/functions/optimize-debts/simplify.test.ts
import { assertEquals } from "jsr:@std/assert";
import { type Balance, simplifyDebts } from "./simplify.ts";

// Invariant helpers ----------------------------------------------------------
function sumTransfers(transfers: { amount: number }[]): number {
  return transfers.reduce((s, t) => s + t.amount, 0);
}

Deno.test("chain A->B->C collapses to a single A->C transfer", () => {
  // A owes B 100, B owes C 100  =>  net: A -100, B 0, C +100
  const balances: Balance[] = [
    { userId: "A", amount: -100 },
    { userId: "B", amount: 0 },
    { userId: "C", amount: 100 },
  ];
  const transfers = simplifyDebts(balances);
  assertEquals(transfers, [{ from: "A", to: "C", amount: 100 }]);
});

Deno.test("never exceeds N-1 transfers and conserves total", () => {
  const balances: Balance[] = [
    { userId: "A", amount: -50 },
    { userId: "B", amount: -30 },
    { userId: "C", amount: 60 },
    { userId: "D", amount: 20 },
  ];
  const transfers = simplifyDebts(balances);
  // 4 people => at most 3 transfers.
  assertEquals(transfers.length <= 3, true);
  // Money out of debtors equals money into creditors.
  assertEquals(sumTransfers(transfers), 80);
});

Deno.test("all-zero balances produce no transfers", () => {
  assertEquals(simplifyDebts([{ userId: "A", amount: 0 }]), []);
});
