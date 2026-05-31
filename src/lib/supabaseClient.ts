import { createClient } from "@supabase/supabase-js";
import { getOrCreateDeviceToken } from "./deviceToken";

// Defaults point at a local `supabase start` stack. The anon key below is the
// well-known local development key shipped by the Supabase CLI (safe to commit;
// it only works against a local instance). Override both via .env.local for
// staging/production.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54321";
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

// Every request carries the guest token so RLS can identify the caller. There
// is no Supabase Auth session in this app — the x-user-token header is the
// credential.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
  global: {
    headers: {
      "x-user-token": getOrCreateDeviceToken(),
    },
  },
});
