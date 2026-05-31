# Bill System · 多人即時共用記帳系統

A login-free, real-time shared expense tracker for splitting bills among friends on trips or
group meals — **Kahoot-style**. No registration required: create a room or enter a **room code**
to join, pick a nickname, and start tracking. When the activity ends, the system computes the
minimum set of repayments needed to settle up.

## Features

- **No-login rooms** — Join with a room code. A per-device UUID is stored in `localStorage` as
  your identity token, so refreshing or reopening the browser automatically reclaims your
  nickname and history.
- **Shared bill entry** — Every member can add bills. Only the bill's creator can edit it later.
- **Safe settlement state machine** — Bills are never hard-deleted. Repayment flows through
  `Unpaid → Pending_Confirm → Settled`, requiring both parties to confirm before a debt is closed.
- **Multi-currency** — Set a base currency per room (e.g. TWD). Bills can be entered in other
  currencies (JPY, USD, …); the original amount and the converted base amount are both stored so
  later exchange-rate drift doesn't affect settlement.
- **Debt simplification** — A greedy graph algorithm minimizes the number of transactions
  (e.g. *A owes B 100, B owes C 100* → *A pays C 100*).
- **Realtime sync + action log** — Powered by Supabase Realtime. All members see live updates and
  a running activity feed ("Ming added Dinner $500", "Hua confirmed Ming's repayment").
- **PWA** — Installable on mobile via `vite-plugin-pwa`.

## Tech Stack

| Layer    | Technology                                          |
| -------- | --------------------------------------------------- |
| Frontend | React 19, TypeScript, Vite 6, Tailwind CSS 4        |
| Backend  | Supabase (PostgreSQL, Realtime, Edge Functions)     |
| PWA      | vite-plugin-pwa                                      |

## Project Structure

```
src/
  components/      UI: Home, RoomDashboard, AddBillForm, BillFeed, SettlementPanel
  hooks/           useAuth, useRoomBills, useRoomMembers
  lib/             supabaseClient, roomApi, billApi, exchangeRate, deviceToken
  types.ts         shared types
supabase/
  migrations/      SQL schema, RLS policies, RPCs
  functions/       Edge Functions (optimize-debts + tests)
scripts/           generate-pwa-icons.mjs
```

## Getting Started

### Prerequisites

- Node.js 18+
- A Supabase project ([supabase.com](https://supabase.com))

### Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Configure environment variables — copy the example and fill in your Supabase values:

   ```bash
   cp .env.example .env.local
   ```

   ```env
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```

3. Apply the database schema and deploy functions (requires the
   [Supabase CLI](https://supabase.com/docs/guides/cli)):

   ```bash
   supabase db push
   supabase functions deploy optimize-debts
   ```

### Scripts

| Command           | Description                              |
| ----------------- | ---------------------------------------- |
| `npm run dev`     | Start the Vite dev server                |
| `npm run build`   | Type-check (`tsc -b`) and build for prod |
| `npm run preview` | Preview the production build locally     |

## Database

Schema, Row Level Security policies, and RPCs live in `supabase/migrations/`. RLS leverages the
client-side UUID to enforce that **only a bill's creator can edit it** and **only the host can
close a room**. Rooms idle for ~1 month are archived automatically.

The debt-simplification logic is implemented as a Supabase Edge Function in
`supabase/functions/optimize-debts/`, with unit tests in `simplify.test.ts`.

## License

Private project — not currently licensed for distribution.
