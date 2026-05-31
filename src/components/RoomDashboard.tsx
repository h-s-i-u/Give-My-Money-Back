import { useState } from "react";
import { useRoomMembers } from "../hooks/useRoomMembers";
import AddBillForm from "./AddBillForm";
import BillFeed from "./BillFeed";
import SettlementPanel from "./SettlementPanel";
import type { Bill, Room } from "../types";

interface Props {
  room: Room;
  memberId: string | null;
  onLeave: () => void;
}

export default function RoomDashboard({ room, memberId, onLeave }: Props) {
  const { members, live } = useRoomMembers(room.id);
  const [copied, setCopied] = useState(false);
  const [editingBill, setEditingBill] = useState<Bill | null>(null);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(room.room_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 bg-[radial-gradient(60rem_40rem_at_50%_-10%,rgba(34,211,238,0.12),transparent),radial-gradient(50rem_40rem_at_100%_10%,rgba(139,92,246,0.12),transparent)]">
      <div className="mx-auto max-w-5xl px-4 py-6">
        {/* Header */}
        <header className="card flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-500">
              Room Code
            </p>
            <div className="mt-1 flex items-center gap-3">
              <span className="bg-gradient-to-r from-cyan-300 to-violet-300 bg-clip-text font-mono text-4xl font-black tracking-[0.25em] text-transparent">
                {room.room_code}
              </span>
              <button onClick={copyCode} title="Copy code" className="btn-ghost px-3 py-1.5 text-sm">
                {copied ? "✅" : "📋"}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="pill">Base · {room.base_currency}</span>
            <span className="pill capitalize">{room.status}</span>
            <button onClick={onLeave} className="btn-ghost text-sm">Leave</button>
          </div>
        </header>

        {/* Members */}
        <section className="card mt-4 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400">
              Members ({members.length})
            </h2>
            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-400">
              <span className={`h-2 w-2 rounded-full ${live ? "animate-pulse bg-emerald-400" : "bg-slate-600"}`} />
              {live ? "Live" : "…"}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {members.map((m) => (
              <span
                key={m.id}
                className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 py-1 pl-1 pr-3"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 to-violet-500 text-xs font-black text-slate-950">
                  {m.nickname.charAt(0).toUpperCase()}
                </span>
                <span className="text-sm font-semibold text-slate-100">{m.nickname}</span>
                {m.is_host && <span className="text-xs">👑</span>}
                {m.id === memberId && <span className="text-[10px] font-bold text-cyan-300">YOU</span>}
              </span>
            ))}
          </div>
        </section>

        {/* Feature grid */}
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <AddBillForm
              roomId={room.id}
              baseCurrency={room.base_currency}
              members={members}
              currentMemberId={memberId}
              editingBill={editingBill}
              onDoneEditing={() => setEditingBill(null)}
            />
            <SettlementPanel roomId={room.id} />
          </div>
          <BillFeed
            roomId={room.id}
            baseCurrency={room.base_currency}
            members={members}
            currentMemberId={memberId}
            onEdit={setEditingBill}
          />
        </div>
      </div>
    </main>
  );
}
