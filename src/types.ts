export type RoomStatus = "active" | "settled" | "archived";

export interface Room {
  id: string;
  room_code: string;
  name: string | null;
  base_currency: string;
  status: RoomStatus;
  host_user_id: string | null;
  created_at: string;
  last_activity_at: string;
  settled_at: string | null;
  archived_at: string | null;
}

/** Safe, publicly-readable member shape (never includes the secret `token`). */
export interface RoomMember {
  id: string;
  room_id: string;
  nickname: string;
  is_host: boolean;
  created_at: string;
}

export interface RoomSession {
  room: Room;
  member: RoomMember;
}

export type BillStatus = "active" | "pending_delete" | "deleted";

export interface Bill {
  id: string;
  room_id: string;
  creator_user_id: string;
  payer_user_id: string;
  title: string;
  note: string | null;
  original_currency: string;
  original_amount: number;
  exchange_rate: number;
  base_amount: number;
  split_among: string[];
  status: BillStatus;
  delete_requested_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface NetBalance {
  user_id: string;
  nickname: string | null;
  net_balance: number;
}

export interface SettlementTransfer {
  from_user_id: string;
  from_nickname: string | null;
  to_user_id: string;
  to_nickname: string | null;
  amount: number;
}

export interface SettlementResult {
  room_id: string;
  base_currency: string;
  net_balances: NetBalance[];
  settlement_plan: SettlementTransfer[];
  transaction_count: number;
}
