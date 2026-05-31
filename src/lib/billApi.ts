import { supabase } from "./supabaseClient";
import { getOrCreateDeviceToken } from "./deviceToken";
import type { Bill, SettlementResult } from "../types";

export interface AddBillInput {
  roomId: string;
  title: string;
  note?: string;
  originalCurrency: string;
  originalAmount: number;
  exchangeRate: number;
  baseAmount: number;
  payerUserId: string;
  /** Explicit "For Whom"/debtors list — the bill is split equally across these. */
  splitAmong: string[];
}

/** Record an expense (and its derived per-participant debts) atomically. */
export async function addBill(input: AddBillInput): Promise<Bill> {
  const { data, error } = await supabase.rpc("add_bill", {
    p_room_id: input.roomId,
    p_title: input.title,
    p_note: input.note ?? null,
    p_original_currency: input.originalCurrency,
    p_original_amount: input.originalAmount,
    p_exchange_rate: input.exchangeRate,
    p_base_amount: input.baseAmount,
    p_payer_user_id: input.payerUserId,
    p_split_among: input.splitAmong,
  });
  if (error) throw new Error(humanizeBillError(error.message));
  return data as Bill;
}

export interface UpdateBillInput extends AddBillInput {
  billId: string;
}

/** Edit an existing bill (creator-only; enforced server-side). */
export async function updateBill(input: UpdateBillInput): Promise<Bill> {
  const { data, error } = await supabase.rpc("update_bill", {
    p_bill_id: input.billId,
    p_title: input.title,
    p_note: input.note ?? null,
    p_original_currency: input.originalCurrency,
    p_original_amount: input.originalAmount,
    p_exchange_rate: input.exchangeRate,
    p_base_amount: input.baseAmount,
    p_payer_user_id: input.payerUserId,
    p_split_among: input.splitAmong,
  });
  if (error) throw new Error(humanizeBillError(error.message));
  return data as Bill;
}

/** Step A: a participant requests deletion → bill becomes 'pending_delete'. */
export async function requestBillDelete(billId: string): Promise<Bill> {
  const { data, error } = await supabase.rpc("request_bill_delete", { p_bill_id: billId });
  if (error) throw new Error(humanizeBillError(error.message));
  return data as Bill;
}

/** Step D: a DIFFERENT participant confirms → bill becomes 'deleted' (soft). */
export async function confirmBillDelete(billId: string): Promise<Bill> {
  const { data, error } = await supabase.rpc("confirm_bill_delete", { p_bill_id: billId });
  if (error) throw new Error(humanizeBillError(error.message));
  return data as Bill;
}

/** All bills for a room, newest first (used for the initial feed render). */
export async function getBills(roomId: string): Promise<Bill[]> {
  const { data, error } = await supabase
    .from("bills")
    .select("*")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Bill[];
}

/** Call the Phase 2 `optimize-debts` Edge Function for the minimized plan. */
export async function getSettlement(roomId: string): Promise<SettlementResult> {
  const { data, error } = await supabase.functions.invoke<SettlementResult>("optimize-debts", {
    body: { room_id: roomId },
    headers: { "x-user-token": getOrCreateDeviceToken() },
  });
  if (error) throw new Error(error.message ?? "Failed to calculate settlement.");
  if (!data) throw new Error("No settlement data returned.");
  return data;
}

function humanizeBillError(message: string): string {
  if (/DUPLICATE_BILL_TITLE/.test(message))
    return "A bill with the same name already exists. Please rename it (e.g. Dinner - Day 1).";
  if (/TITLE_REQUIRED/.test(message)) return "Please enter a description.";
  if (/INVALID_AMOUNT/.test(message)) return "Amount must be greater than zero.";
  if (/NO_PARTICIPANTS/.test(message)) return "Select at least one participant.";
  if (/INVALID_PAYER/.test(message)) return "The selected payer is not in this room.";
  if (/INVALID_PARTICIPANT/.test(message)) return "A selected participant is not in this room.";
  if (/NOT_A_MEMBER/.test(message)) return "You are not a member of this room.";
  if (/NOT_BILL_CREATOR/.test(message)) return "Only the person who created this bill can edit it.";
  if (/BILL_NOT_EDITABLE/.test(message)) return "This bill can no longer be edited.";
  if (/BILL_NOT_ACTIVE/.test(message)) return "This bill is already being deleted.";
  if (/NOT_PENDING_DELETE/.test(message)) return "This bill is not awaiting delete confirmation.";
  if (/NEED_OTHER_PARTY/.test(message))
    return "You requested the deletion — another participant must confirm it.";
  if (/NOT_A_PARTICIPANT/.test(message)) return "Only people involved in this bill can do that.";
  if (/BILL_NOT_FOUND/.test(message)) return "That bill no longer exists.";
  return message;
}
