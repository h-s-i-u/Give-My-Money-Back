import { useState } from "react";
import { createRoom, joinRoom } from "../lib/roomApi";
import type { RoomSession } from "../types";

const CURRENCIES = ["TWD", "JPY", "USD", "EUR", "KRW", "GBP", "CNY", "THB"];

type Mode = "choose" | "create" | "join";

export default function Home({ onEnter }: { onEnter: (session: RoomSession) => void }) {
  const [mode, setMode] = useState<Mode>("choose");
  const [nickname, setNickname] = useState("");
  const [baseCurrency, setBaseCurrency] = useState("TWD");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setMode("choose");
    setError(null);
    setCode("");
  };

  async function run(fn: () => Promise<RoomSession>) {
    setBusy(true);
    setError(null);
    try {
      onEnter(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 bg-[radial-gradient(60rem_40rem_at_50%_-10%,rgba(34,211,238,0.15),transparent),radial-gradient(50rem_40rem_at_100%_110%,rgba(139,92,246,0.15),transparent)] p-4">
      <div className="card w-full max-w-md p-8">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-violet-500 text-3xl shadow-lg shadow-cyan-500/30">
            💸
          </div>
          <h1 className="bg-gradient-to-r from-cyan-300 to-violet-300 bg-clip-text text-3xl font-black tracking-tight text-transparent">
            SplitParty
          </h1>
          <p className="mt-1 text-sm font-medium text-slate-400">
            Split bills together — no signup needed.
          </p>
        </div>

        {error && (
          <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-300">
            {error}
          </div>
        )}

        {mode === "choose" && (
          <div className="mt-8 space-y-3">
            <button
              onClick={() => { setMode("create"); setError(null); }}
              className="btn-primary w-full py-4 text-lg"
            >
              🚀 Create New Room
            </button>
            <button
              onClick={() => { setMode("join"); setError(null); }}
              className="btn-ghost w-full py-4 text-lg"
            >
              🔑 Join Existing Room
            </button>
          </div>
        )}

        {mode === "create" && (
          <div className="mt-8 space-y-4">
            <div>
              <label className="label">Your nickname</label>
              <input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                maxLength={24}
                placeholder="e.g. Ming"
                className="input"
                autoFocus
              />
            </div>
            <div>
              <label className="label">Base currency</label>
              <select value={baseCurrency} onChange={(e) => setBaseCurrency(e.target.value)} className="input">
                {CURRENCIES.map((c) => (
                  <option key={c} value={c} className="bg-slate-900">{c}</option>
                ))}
              </select>
            </div>
            <button
              disabled={busy || !nickname.trim()}
              onClick={() => run(() => createRoom(nickname.trim(), baseCurrency))}
              className="btn-primary w-full py-3.5 text-lg"
            >
              {busy ? "Creating…" : "Create Room"}
            </button>
            <BackButton onClick={reset} />
          </div>
        )}

        {mode === "join" && (
          <div className="mt-8 space-y-4">
            <div>
              <label className="label">Room code</label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
                placeholder="AB7901"
                className="input text-center text-2xl font-black tracking-[0.4em] uppercase"
                autoFocus
              />
            </div>
            <div>
              <label className="label">Your nickname</label>
              <input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                maxLength={24}
                placeholder="e.g. Hua"
                className="input"
              />
            </div>
            <button
              disabled={busy || code.trim().length !== 6 || !nickname.trim()}
              onClick={() => run(() => joinRoom(code, nickname.trim()))}
              className="btn-primary w-full py-3.5 text-lg"
            >
              {busy ? "Joining…" : "Join Room"}
            </button>
            <BackButton onClick={reset} />
          </div>
        )}
      </div>
    </main>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-xl px-6 py-2 text-sm font-bold text-slate-500 transition hover:text-slate-200"
    >
      ← Back
    </button>
  );
}
