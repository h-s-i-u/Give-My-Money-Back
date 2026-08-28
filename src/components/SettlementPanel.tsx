import { useCallback, useEffect, useMemo, useState } from "react";
import { getSettlement } from "../lib/billApi";
import type { Bill, SettlementResult } from "../types";

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

interface Props {
  roomId: string;
  /** The room's live ledger; the plan is re-derived whenever it changes. */
  bills: Bill[];
  billsLoaded: boolean;
}

/**
 * Fingerprint of everything the settlement actually depends on. Editing a bill's
 * description leaves this unchanged, so cosmetic edits don't trigger a needless
 * round-trip to the Edge Function.
 */
function ledgerSignature(bills: Bill[]): string {
  return bills
    .filter((b) => b.status !== "deleted")
    .map((b) => `${b.id}:${b.base_amount}:${b.payer_user_id}:${b.split_among.join("|")}`)
    .sort()
    .join(";");
}

export default function SettlementPanel({ roomId, bills, billsLoaded }: Props) {
  const [result, setResult] = useState<SettlementResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const calculate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await getSettlement(roomId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to calculate settlement.");
    } finally {
      setBusy(false);
    }
  }, [roomId]);

  const signature = useMemo(() => ledgerSignature(bills), [bills]);

  // Recalculate whenever the ledger changes — including changes pushed from
  // another device over Realtime — so every member always sees the same plan
  // without anyone having to press the button. Debounced so a burst of edits
  // (or a Realtime batch) collapses into a single call.
  useEffect(() => {
    if (!billsLoaded) return; // don't settle an empty ledger that's still loading
    const timer = setTimeout(() => void calculate(), 300);
    return () => clearTimeout(timer);
  }, [signature, billsLoaded, calculate]);

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">Final Settlement</h2>
        <button onClick={() => void calculate()} disabled={busy} className="btn-primary text-sm">
          {busy ? "Calculating…" : "↻ Refresh"}
        </button>
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {result && (
        <>
          <ul className="mt-4 space-y-2">
            {result.settlement_plan.map((t, i) => (
              <li
                key={i}
                className="flex items-center justify-between rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] px-4 py-3"
              >
                <span className="text-sm text-slate-200">
                  <span className="font-bold text-white">{t.from_nickname ?? "?"}</span>
                  <span className="mx-2 text-emerald-300">→</span>
                  <span className="font-bold text-white">{t.to_nickname ?? "?"}</span>
                </span>
                <span className="font-mono font-bold text-emerald-300">
                  {fmt(t.amount)} {result.base_currency}
                </span>
              </li>
            ))}
            {result.settlement_plan.length === 0 && (
              <li className="rounded-xl border border-white/5 bg-white/[0.03] px-4 py-6 text-center text-sm text-slate-500">
                🎉 All settled — nobody owes anything.
              </li>
            )}
          </ul>

          <p className="mt-3 text-xs text-slate-500">
            {result.transaction_count} transfer{result.transaction_count === 1 ? "" : "s"} needed
            to settle all debts.
          </p>
        </>
      )}
    </section>
  );
}
