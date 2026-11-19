import type { Config } from "@netlify/functions";
import { DERIV_SCOPES, getAppId, getRedirectUri } from "../lib/config.js";
import { json, isSecureRequest } from "../lib/http.js";
import {
  clearSessionCookie,
  deleteSession,
  fetchAccounts,
  getAccessToken,
  loadSession,
  updateAccounts,
} from "../lib/session.js";

/**
 * Connected-account status for the dashboard. Returns only non-sensitive
 * metadata (account ids, type, currency, balance, expiry) — never the token.
 */
export default async (req: Request) => {
  const secure = isSecureRequest(req);
  const appId = getAppId();
  const base = {
    configured: Boolean(appId),
    missing: appId ? [] : ["DERIV_APP_ID"],
    redirectUri: getRedirectUri(req),
    scopes: DERIV_SCOPES,
  };

  if (!base.configured) return json({ ...base, connected: false });

  let row;
  try {
    row = await loadSession(req);
  } catch {
    return json({ ...base, connected: false, reason: "storage_unavailable" }, 503);
  }
  if (!row) return json({ ...base, connected: false });

  const expired = row.expiresAt.getTime() <= Date.now();
  const token = expired ? null : await getAccessToken(row).catch(() => null);
  if (!token) {
    await deleteSession(row).catch(() => undefined);
    return json({ ...base, connected: false, reason: "expired" }, 200, [clearSessionCookie(secure)]);
  }

  const result = await fetchAccounts(token, appId!);
  if (!result.ok && result.reason === "unauthorized") {
    // Revoked or expired at Deriv: Deriv issues no refresh tokens, so the user must reconnect.
    await deleteSession(row).catch(() => undefined);
    return json({ ...base, connected: false, reason: "expired" }, 200, [clearSessionCookie(secure)]);
  }
  if (result.ok) await updateAccounts(row, result.accounts).catch(() => undefined);

  return json({
    ...base,
    connected: true,
    expiresAt: row.expiresAt.toISOString(),
    scope: row.scope,
    accounts: result.ok ? result.accounts : (row.accounts ?? []),
    accountsError: result.ok ? null : result.reason,
  });
};

export const config: Config = {
  path: "/api/deriv/status",
  method: "GET",
};
