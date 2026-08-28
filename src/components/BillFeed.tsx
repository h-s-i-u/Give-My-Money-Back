import { useState } from "react";
import { confirmBillDelete, requestBillDelete } from "../lib/billApi";
import type { Bill, RoomMember } from "../types";

interface Props {
  /** Live ledger, owned by RoomDashboard and shared with the settlement panel. */
  bills: Bill[];
  live: boolean;
  loaded: boolean;
  baseCurrency: string;
  members: RoomMember[];
  currentMemberId: string | null;
  onEdit: (bill: Bill) => void;
}

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

const participantsOf = (b: Bill) =>
  Array.from(new Set([b.payer_user_id, ...b.split_among]));

export default function BillFeed({
  bills,
  live,
  loaded,
  baseCurrency,
  members,
  currentMemberId,
  onEdit,
}: Props) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const nameOf = (id: string) => members.find((m) => m.id === id)?.nickname ?? "Someone";

  async function run(billId: string, fn: () => Promise<unknown>) {
    setPendingId(billId);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">Activity</h2>
        <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-400">
          <span className={`h-2 w-2 rounded-full ${live ? "animate-pulse bg-emerald-400" : "bg-slate-600"}`} />
          {live ? "Live" : "…"}
        </span>
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <ul className="mt-4 space-y-2">
        {bills.map((b) => {
          const deleted = b.status === "deleted";
          const pendingDelete = b.status === "pending_delete";
          const converted = b.original_currency !== baseCurrency;
          const isCreator = !!currentMemberId && b.creator_user_id === currentMemberId;
          const isParticipant = !!currentMemberId && participantsOf(b).includes(currentMemberId);
          const iRequested = b.delete_requested_by === currentMemberId;
          const busy = pendingId === b.id;

          return (
            <li
              key={b.id}
              className={
                "rounded-xl border px-4 py-3 " +
                (deleted
                  ? "border-white/5 bg-white/[0.02] opacity-50"
                  : pendingDelete
                    ? "border-amber-400/30 bg-amber-400/[0.06]"
                    : "border-white/5 bg-white/[0.03]")
              }
            >
              <p className={"text-sm text-slate-200 " + (deleted ? "line-through" : "")}>
                <span className="font-bold text-white">{nameOf(b.creator_user_id)}</span>{" "}
                added <span className="font-semibold text-cyan-300">{b.title}</span>{" "}
                <span className="font-mono text-slate-300">
                  {fmt(b.original_amount)} {b.original_currency}
                </span>
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                Paid by {nameOf(b.payer_user_id)}
                {converted && (
                  <> · ≈ <span className="font-mono text-slate-400">{fmt(b.base_amount)} {baseCurrency}</span></>
                )}
              </p>
              {b.split_among?.length > 0 && (
                <p className="mt-0.5 text-xs text-slate-500">
                  For: <span className="text-slate-400">{b.split_among.map(nameOf).join(", ")}</span>
                  {" "}· {fmt(b.base_amount / b.split_among.length)} {baseCurrency} each
                </p>
              )}

              {/* ---- Status / action row ---- */}
              {deleted && (
                <p className="mt-2 text-xs font-semibold text-slate-500">🗑️ Deleted</p>
              )}

              {pendingDelete && (
                <div className="mt-2">
                  {isParticipant && !iRequested ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-amber-300">
                        Deletion requested by {b.delete_requested_by ? nameOf(b.delete_requested_by) : "a participant"}.
                      </span>
                      <button
                        disabled={busy}
                        onClick={() => run(b.id, () => confirmBillDelete(b.id))}
                        className="rounded-lg bg-red-500/90 px-3 py-1 text-xs font-bold text-white transition hover:bg-red-500 disabled:opacity-40"
                      >
                        {busy ? "…" : "Confirm Delete"}
                      </button>
                    </div>
                  ) : (
                    <p className="text-xs font-semibold text-amber-300">
                      ⏳ Waiting for the other party to confirm deletion…
                    </p>
                  )}
                </div>
              )}

              {b.status === "active" && (isCreator || isParticipant) && (
                <div className="mt-2 flex gap-2">
                  {isCreator && (
                    <button
                      onClick={() => onEdit(b)}
                      className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:bg-white/10"
                    >
                      ✎ Edit
                    </button>
                  )}
                  {isParticipant && (
                    <button
                      disabled={busy}
                      onClick={() => run(b.id, () => requestBillDelete(b.id))}
                      className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-1 text-xs font-semibold text-red-300 transition hover:bg-red-500/20 disabled:opacity-40"
                    >
                      {busy ? "…" : "Delete / Settle"}
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
        {bills.length === 0 && (
          <li className="rounded-xl border border-white/5 bg-white/[0.03] px-4 py-6 text-center text-sm text-slate-500">
            {loaded ? "No bills yet — add the first one!" : "Loading bills…"}
          </li>
        )}
      </ul>
    </section>
  );
}
