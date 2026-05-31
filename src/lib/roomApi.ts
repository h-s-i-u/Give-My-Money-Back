import { supabase } from "./supabaseClient";
import type { Room, RoomMember, RoomSession } from "../types";

/** Columns safe to read for the member list (excludes the secret `token`). */
export const MEMBER_COLUMNS = "id, room_id, nickname, is_host, created_at";

const CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** Random 6-character uppercase alphanumeric room code, e.g. "AB7901". */
export function generateRoomCode(length = 6): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

function isUniqueViolation(error: { code?: string; message?: string }): boolean {
  return error.code === "23505" || /duplicate key|already exists/i.test(error.message ?? "");
}

/**
 * Create a new room as its host. Generates a unique room code (retrying on the
 * rare collision) and delegates the atomic room+host insert to the create_room
 * RPC.
 */
export async function createRoom(nickname: string, baseCurrency: string): Promise<RoomSession> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data, error } = await supabase.rpc("create_room", {
      p_room_code: generateRoomCode(),
      p_base_currency: baseCurrency,
      p_nickname: nickname,
    });

    if (!error) return data as RoomSession;
    if (isUniqueViolation(error)) continue; // code clash — try another
    throw new Error(humanizeRoomError(error.message));
  }
  throw new Error("Could not generate a unique room code. Please try again.");
}

/** Join an existing room by code (or re-claim an existing membership). */
export async function joinRoom(code: string, nickname: string): Promise<RoomSession> {
  const { data, error } = await supabase.rpc("join_room", {
    p_room_code: code.trim().toUpperCase(),
    p_nickname: nickname,
  });
  if (error) throw new Error(humanizeRoomError(error.message));
  return data as RoomSession;
}

/** Fetch a room by id (used to restore session after a page refresh). */
export async function getRoom(roomId: string): Promise<Room | null> {
  const { data, error } = await supabase.from("rooms").select("*").eq("id", roomId).maybeSingle();
  if (error) throw error;
  return (data as Room) ?? null;
}

/** Current member list for a room, oldest first. */
export async function getMembers(roomId: string): Promise<RoomMember[]> {
  const { data, error } = await supabase
    .from("users")
    .select(MEMBER_COLUMNS)
    .eq("room_id", roomId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as RoomMember[];
}

function humanizeRoomError(message: string): string {
  if (/NICKNAME_TAKEN/.test(message))
    return "This nickname is already being used in the room. Please choose a different name.";
  if (/ROOM_NOT_FOUND/.test(message)) return "Room not found. Please check the code.";
  if (/ROOM_CLOSED/.test(message)) return "This room is closed and can no longer be joined.";
  if (/NICKNAME_REQUIRED/.test(message)) return "Please enter a nickname.";
  if (/MISSING_USER_TOKEN/.test(message)) return "Could not identify this device. Please reload.";
  return message;
}
