import type { Config } from "@netlify/functions";
import { json, isSameOrigin, isSecureRequest } from "../lib/http.js";
import { clearSessionCookie, deleteSessionFromRequest } from "../lib/session.js";

/**
 * Disconnect: deletes the stored (encrypted) Deriv token and clears the
 * session cookie. Deriv's docs list no token-revocation endpoint, so the
 * token is destroyed on our side; users can also remove app access from
 * their Deriv account settings.
 */
export default async (req: Request) => {
  if (!isSameOrigin(req)) return json({ error: "forbidden" }, 403);
  await deleteSessionFromRequest(req).catch(() => undefined);
  return json({ connected: false }, 200, [clearSessionCookie(isSecureRequest(req))]);
};

export const config: Config = {
  path: "/api/deriv/logout",
  method: "POST",
};
