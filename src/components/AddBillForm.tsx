import { useEffect, useState } from "react";
import { addBill, updateBill } from "../lib/billApi";
import { getExchangeRate } from "../lib/exchangeRate";
import type { Bill, RoomMember } from "../types";

const CURRENCIES = ["TWD", "JPY", "USD", "EUR", "KRW", "GBP", "CNY", "THB", "HKD", "SGD"];

interface Props {
  roomId: string;
  baseCurrency: string;
  members: RoomMember[];
  currentMemberId: string | null;
  /** When set, the form edits this bill instead of creating a new one. */
  editingBill?: Bill | null;
  /** Called after a successful edit, or when the user cancels editing. */
  onDoneEditing?: () => void;
}

export default function AddBillForm({
  roomId,
  baseCurrency,
  members,
  currentMemberId,
  editingBill,
  onDoneEditing,
}: Props) {
  const isEditing = !!editingBill;

  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(baseCurrency);
  const [payerId, setPayerId] = useState("");
  const [forWhom, setForWhom] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setTitle("");
    setAmount("");
    setCurrency(baseCurrency);
    setForWhom(new Set());
    setPayerId(currentMemberId ?? members[0]?.id ?? "");
    setError(null);
  }

  // Load the bill being edited into the form.
  useEffect(() => {
    if (editingBill) {
      setTitle(editingBill.title);
      setAmount(String(editingBill.original_amount));
      setCurrency(editingBill.original_currency);
      setPayerId(editingBill.payer_user_id);
      setForWhom(new Set(editingBill.split_among));
      setError(null);
    }
  }, [editingBill]);

  // Default the payer to the current user when creating (and not yet chosen).
  useEffect(() => {
    if (!isEditing && !payerId && (currentMemberId || members[0])) {
      setPayerId(currentMemberId ?? members[0].id);
    }
  }, [currentMemberId, members, payerId, isEditing]);

  const selectedIds = members.filter((m) => forWhom.has(m.id)).map((m) => m.id);

  function toggle(id: string) {
    setForWhom((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const splitAmongAll = () => setForWhom(new Set(members.map((m) => m.id)));
  const clearAll = () => setForWhom(new Set());

  function cancelEdit() {
    resetForm();
    onDoneEditing?.();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(amount);
    if (!title.trim() || !(amt > 0) || selectedIds.length === 0 || !payerId) {
      setError("Enter a description, a positive amount, and select who this is for.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const rate = await getExchangeRate(currency, baseCurrency);
      const baseAmount = Math.round(amt * rate * 100) / 100;
      const payload = {
        roomId,
        title: title.trim(),
        originalCurrency: currency,
        originalAmount: amt,
        exchangeRate: rate,
        baseAmount,
        payerUserId: payerId,
        splitAmong: selectedIds,
      };
      if (isEditing && editingBill) {
        await updateBill({ billId: editingBill.id, ...payload });
        resetForm();
        onDoneEditing?.();
      } else {
        await addBill(payload);
        resetForm();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save bill.");
    } finally {
      setBusy(false);
    }
  }

  const previewAmt = Number(amount);
  const perHead =
    previewAmt > 0 && selectedIds.length > 0
      ? (previewAmt / selectedIds.length).toLocaleString(undefined, { maximumFractionDigits: 2 })
      : null;

  return (
    <form
      onSubmit={handleSubmit}
      className={"card p-5 " + (isEditing ? "ring-2 ring-cyan-400/50" : "")}
    >
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-bold text-white">
          <span className="text-cyan-400">{isEditing ? "✎" : "＋"}</span>
          {isEditing ? "Edit Bill" : "Add Bill"}
        </h2>
        {isEditing && (
          <button type="button" onClick={cancelEdit} className="text-sm font-semibold text-slate-400 hover:text-slate-200">
            Cancel
          </button>
        )}
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="mt-4 space-y-4">
        <div>
          <label className="label">Description</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={60}
            placeholder="e.g. Dinner"
            className="input"
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className="label">Amount</label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              inputMode="decimal"
              placeholder="0.00"
              className="input"
            />
          </div>
          <div>
            <label className="label">Currency</label>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="input">
              {Array.from(new Set([baseCurrency, ...CURRENCIES])).map((c) => (
                <option key={c} value={c} className="bg-slate-900">{c}</option>
              ))}
            </select>
          </div>
        </div>

        {currency !== baseCurrency && previewAmt > 0 && (
          <p className="text-xs text-slate-400">
            Will be converted to <span className="font-semibold text-cyan-300">{baseCurrency}</span>{" "}
            at submit using a live exchange rate.
          </p>
        )}

        <div>
          <label className="label">Payer (who paid)</label>
          <select value={payerId} onChange={(e) => setPayerId(e.target.value)} className="input">
            {members.map((m) => (
              <option key={m.id} value={m.id} className="bg-slate-900">
                {m.nickname}{m.id === currentMemberId ? " (you)" : ""}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label className="label mb-0">For Whom / Debtors ({selectedIds.length})</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={splitAmongAll}
                className="rounded-lg border border-cyan-400/40 bg-cyan-400/10 px-2.5 py-1 text-xs font-bold text-cyan-200 transition hover:bg-cyan-400/20"
              >
                Split Among All
              </button>
              {selectedIds.length > 0 && (
                <button
                  type="button"
                  onClick={clearAll}
                  className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-400 transition hover:text-slate-200"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          <p className="mb-2 mt-1 text-xs text-slate-500">
            Select who this expense is for. Include the payer too if it's also for them.
          </p>
          <div className="flex flex-wrap gap-2">
            {members.map((m) => {
              const on = forWhom.has(m.id);
              return (
                <button
                  type="button"
                  key={m.id}
                  onClick={() => toggle(m.id)}
                  className={
                    "rounded-full px-3 py-1.5 text-sm font-semibold transition " +
                    (on
                      ? "bg-cyan-400/20 text-cyan-200 ring-1 ring-cyan-400/40"
                      : "bg-white/5 text-slate-400 ring-1 ring-white/10 hover:text-slate-200")
                  }
                >
                  {on ? "✓ " : ""}{m.nickname}
                </button>
              );
            })}
          </div>
          {perHead && (
            <p className="mt-2 text-xs text-slate-400">
              Each of {selectedIds.length} owes{" "}
              <span className="font-mono font-semibold text-cyan-300">{perHead} {currency}</span>.
            </p>
          )}
        </div>

        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? "Saving…" : isEditing ? "Save Changes" : "Add Bill"}
        </button>
      </div>
    </form>
  );
}
