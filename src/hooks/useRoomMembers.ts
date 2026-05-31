import { useEffect, useState } from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase } from "../lib/supabaseClient";
import { getMembers } from "../lib/roomApi";
import type { RoomMember } from "../types";

export interface RoomMembersState {
  members: RoomMember[];
  /** True once the realtime channel is subscribed and live. */
  live: boolean;
}

const byCreatedAt = (a: RoomMember, b: RoomMember) =>
  a.created_at.localeCompare(b.created_at);

/**
 * Live member list for a room.
 *
 * 1. Loads the current members once over HTTP for the initial render.
 * 2. Opens a Realtime "postgres_changes" subscription on the `users` table,
 *    filtered to this room, and reconciles INSERT/UPDATE/DELETE events into
 *    local state — so a new joiner appears in every open client instantly,
 *    with no polling or manual refresh.
 */
export function useRoomMembers(roomId: string | null): RoomMembersState {
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!roomId) {
      setMembers([]);
      setLive(false);
      return;
    }

    let cancelled = false;

    // 1) Initial snapshot.
    getMembers(roomId)
      .then((rows) => {
        if (!cancelled) setMembers(rows);
      })
      .catch((err) => console.error("Failed to load members:", err));

    // 2) Live updates.
    const channel = supabase
      .channel(`room-members:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "users",
          filter: `room_id=eq.${roomId}`,
        },
        (payload: RealtimePostgresChangesPayload<RoomMember>) => {
          setMembers((prev) => {
            switch (payload.eventType) {
              case "INSERT": {
                const row = payload.new as RoomMember;
                if (prev.some((m) => m.id === row.id)) return prev; // de-dupe
                return [...prev, row].sort(byCreatedAt);
              }
              case "UPDATE": {
                const row = payload.new as RoomMember;
                return prev.map((m) => (m.id === row.id ? { ...m, ...row } : m));
              }
              case "DELETE": {
                const oldRow = payload.old as Partial<RoomMember>;
                return prev.filter((m) => m.id !== oldRow.id);
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

  return { members, live };
}
