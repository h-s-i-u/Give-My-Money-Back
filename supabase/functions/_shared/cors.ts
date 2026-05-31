// Shared CORS headers for browser-invoked Edge Functions.
// `x-user-token` is allowed because that custom header carries the caller's
// login-free identity (the localStorage UUID) used for access control.
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-user-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
