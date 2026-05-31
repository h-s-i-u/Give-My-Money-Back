// =============================================================================
// Edge Function: optimize-debts
//
// POST { "room_id": "<uuid>" }  +  header  x-user-token: <localStorage uuid>
//
// Computes each member's net balance from the room's bills — crediting each
// bill's payer the full amount and dividing the cost only across that bill's
// explicit `split_among` ("For Whom") list — then returns a minimized
// settlement plan (who pays whom, how much) using the greedy algorithm in
// ./simplify.ts. The split is NEVER assumed to be the whole room.
//
// Access control: this function runs with the service-role key (so it can read
// the whole room's ledger), but it first verifies that the caller's
// x-user-token belongs to a member of the room. A non-member gets 403.
// =============================================================================
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { type Balance, simplifyDebts } from "./simplify.ts";

// Outstanding debts are stored in the room base currency as numeric(18,4).
// We work in integer minor units to avoid float drift. SCALE=100 => cents.
// (Symmetric per-debt rounding keeps net balances summing to exactly zero.)
const SCALE = 100;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  // CORS preflight.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed; use POST." });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const roomId: unknown = body?.room_id;
    if (typeof roomId !== "string" || roomId.length === 0) {
      return jsonResponse(400, { error: "Missing or invalid 'room_id'." });
    }

    const userToken = req.headers.get("x-user-token");
    if (!userToken) {
      return jsonResponse(401, { error: "Missing 'x-user-token' header." });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // --- Access control: caller must be a member of the room. ---------------
    const { data: membership, error: membershipErr } = await supabase
      .from("users")
      .select("id")
      .eq("room_id", roomId)
      .eq("token", userToken)
      .maybeSingle();
    if (membershipErr) throw membershipErr;
    if (!membership) {
      return jsonResponse(403, { error: "Caller is not a member of this room." });
    }

    // --- Load room (for base currency) and members. -------------------------
    const { data: room, error: roomErr } = await supabase
      .from("rooms")
      .select("id, base_currency")
      .eq("id", roomId)
      .maybeSingle();
    if (roomErr) throw roomErr;
    if (!room) return jsonResponse(404, { error: "Room not found." });

    const { data: users, error: usersErr } = await supabase
      .from("users")
      .select("id, nickname")
      .eq("room_id", roomId);
    if (usersErr) throw usersErr;

    // --- Load bills with their explicit "For Whom" list. --------------------
    // Soft-deleted bills are completely excluded from settlement; 'active' and
    // 'pending_delete' bills still represent real, unsettled expenses.
    const { data: bills, error: billsErr } = await supabase
      .from("bills")
      .select("payer_user_id, base_amount, split_among")
      .eq("room_id", roomId)
      .neq("status", "deleted");
    if (billsErr) throw billsErr;

    // --- Compute net balances in integer minor units. -----------------------
    // For each bill: the payer is credited the full base_amount, and the cost
    // is divided equally across ONLY the users in split_among (the "For Whom"
    // list) — never across the whole room. If the payer is also in that list
    // they bear a share too, so they net out to (amount fronted − own share).
    //
    // Shares are distributed as integer minor units that sum EXACTLY to the
    // bill total (largest-remainder method), so every bill nets to zero and the
    // room's balances always sum to zero regardless of how N divides the cents.
    const net = new Map<string, number>();
    for (const u of users ?? []) net.set(u.id, 0);

    for (const b of bills ?? []) {
      const involved = (b.split_among ?? []) as string[];
      if (involved.length === 0) continue; // bill covers nobody → no debt

      const totalCents = Math.round(Number(b.base_amount) * SCALE);
      // Payer fronted the whole amount.
      net.set(b.payer_user_id, (net.get(b.payer_user_id) ?? 0) + totalCents);

      // Split the cost across the involved users only.
      const n = involved.length;
      const baseShare = Math.floor(totalCents / n);
      let remainder = totalCents - baseShare * n; // 0..n-1 leftover cents
      for (const uid of involved) {
        const share = baseShare + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder--;
        net.set(uid, (net.get(uid) ?? 0) - share);
      }
    }

    const balances: Balance[] = [...net.entries()].map(([userId, amount]) => ({
      userId,
      amount,
    }));

    // --- Run the greedy simplification. -------------------------------------
    const transfers = simplifyDebts(balances);

    // --- Shape the response (back to decimals + nicknames). -----------------
    const nicknameOf = new Map((users ?? []).map((u) => [u.id, u.nickname]));

    const settlement_plan = transfers.map((t) => ({
      from_user_id: t.from,
      from_nickname: nicknameOf.get(t.from) ?? null,
      to_user_id: t.to,
      to_nickname: nicknameOf.get(t.to) ?? null,
      amount: t.amount / SCALE,
    }));

    const net_balances = balances
      .map((b) => ({
        user_id: b.userId,
        nickname: nicknameOf.get(b.userId) ?? null,
        net_balance: b.amount / SCALE,
      }))
      .sort((a, b) => b.net_balance - a.net_balance);

    return jsonResponse(200, {
      room_id: roomId,
      base_currency: room.base_currency,
      net_balances,
      settlement_plan,
      transaction_count: settlement_plan.length,
    });
  } catch (err) {
    console.error("optimize-debts error:", err);
    return jsonResponse(500, {
      error: err instanceof Error ? err.message : "Internal error.",
    });
  }
});
