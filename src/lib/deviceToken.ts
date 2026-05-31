// Canonical "guest identity" helper for this login-free app.
//
// The user's identity is a random UUID generated on first visit and persisted
// in localStorage. It is sent to the backend as the `x-user-token` header,
// which the database RLS policies use to identify the caller (see migration
// 00001_init.sql). Keeping the get-or-create logic in one place guarantees the
// Supabase client header and the useAuth hook always agree on the same token.

export const DEVICE_TOKEN_KEY = "device_uuid";

/**
 * Returns the persisted device token, generating and storing one on first use.
 * Safe to call repeatedly — it only writes to localStorage the first time.
 */
export function getOrCreateDeviceToken(): string {
  let token = localStorage.getItem(DEVICE_TOKEN_KEY);
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem(DEVICE_TOKEN_KEY, token);
  }
  return token;
}
