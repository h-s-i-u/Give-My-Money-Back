import { useEffect, useState } from "react";
import { getOrCreateDeviceToken } from "../lib/deviceToken";

export interface AuthState {
  /** The guest's persistent UUID (null until initialization completes). */
  userId: string | null;
  /** True once the UUID has been read from / written to localStorage. */
  ready: boolean;
}

/**
 * Guest authentication for the login-free app.
 *
 * On mount it checks localStorage for an existing `device_uuid`; if none
 * exists it generates one with crypto.randomUUID() and persists it. The same
 * UUID is reused on every subsequent visit (this is what enables
 * "reconnect = re-claim identity" when a user refreshes or reopens the tab).
 */
export function useAuth(): AuthState {
  const [userId, setUserId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setUserId(getOrCreateDeviceToken());
    setReady(true);
  }, []);

  return { userId, ready };
}
