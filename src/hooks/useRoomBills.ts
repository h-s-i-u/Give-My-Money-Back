import { useEffect, useState } from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase } from "../lib/supabaseClient";
import { getBills } from "../lib/billApi";
import type { Bill } from "../types";

export interface RoomBillsState {
  bills: Bill[]; // newest first
  live: boolean;
}

const newestFirst = (a: Bill, b: Bill) => b.created_at.localeCompare(a.created_at);

/**
 * Live bill list for a room. Mirrors useRoomMembers: an initial HTTP snapshot
 * plus a Realtime "postgres_changes" subscription on the `bills` table, so a
 * bill added on one device appears on every other device instantly.
 */
export function useRoomBills(roomId: string | null): RoomBillsState {
  const [bills, setBills] = useState<Bill[]>([]);
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!roomId) {
      setBills([]);
      setLive(false);
      return;
    }

    let cancelled = false;

    getBills(roomId)
      .then((rows) => {
        if (!cancelled) setBills(rows);
      })
      .catch((err) => console.error("Failed to load bills:", err));

    const channel = supabase
      .channel(`room-bills:${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bills", filter: `room_id=eq.${roomId}` },
        (payload: RealtimePostgresChangesPayload<Bill>) => {
          setBills((prev) => {
            switch (payload.eventType) {
              case "INSERT": {
                const row = payload.new as Bill;
                if (prev.some((b) => b.id === row.id)) return prev;
                return [row, ...prev].sort(newestFirst);
              }
              case "UPDATE": {
                const row = payload.new as Bill;
                return prev.map((b) => (b.id === row.id ? { ...b, ...row } : b));
              }
              case "DELETE": {
                const oldRow = payload.old as Partial<Bill>;
                return prev.filter((b) => b.id !== oldRow.id);
              }
              default:
                return prev;
            }
          });
        },
      )
      .subscribe((status) => {
        if (!cancelled) setLive(status === "SUBSCRIBED");
      });

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [roomId]);

  return { bills, live };
}
