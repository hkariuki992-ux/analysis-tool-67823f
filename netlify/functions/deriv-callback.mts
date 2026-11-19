import type { Config } from "@netlify/functions";
import { DERIV_TOKEN_URL, OAUTH_COOKIE, getAppId, getRedirectUri, isConfigured } from "../lib/config.js";
import { decrypt, safeEqual } from "../lib/crypto.js";
import { clearCookie, isSecureRequest, readCookie, redirect } from "../lib/http.js";
import {
  createSession,
  deleteSessionFromRequest,
  fetchAccounts,
  purgeExpiredSessions,
} from "../lib/session.js";

/**
 * Deriv OAuth 2.0 callback.
 *
 * Register EXACTLY this URL on Deriv:
 *   https://analysis-tool-67823f.netlify.app/auth/deriv/callback
 *
 * Flow: validate `state` against the encrypted PKCE cookie -> exchange the
 * one-time `code` + `code_verifier` for an access token (server-to-server) ->
 * store the token encrypted in Netlify Database -> set an httpOnly session
 * cookie -> send the browser back to the dashboard. The authorization code and
 * access token are never logged and never reach frontend code.
 */
export default async (req: Request) => {
  const url = new URL(req.url);
  const secure = isSecureRequest(req);
  const clearFlow = clearCookie(OAUTH_COOKIE, "/auth/deriv", secure);
  // The callback URL carries the one-time code: never leak it via Referer.
  const noReferrer = { "Referrer-Policy": "no-referrer" };
  const fail = (code: string) => redirect(`/?deriv_error=${code}`, [clearFlow], noReferrer);

  if (!isConfigured()) return fail("not_configured");

  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    return fail(oauthError === "access_denied" ? "access_denied" : "authorization_failed");
  }

  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  if (!code || !returnedState) return fail("missing_code");

  // 1. Secure state validation (CSRF protection) + PKCE verifier recovery.
  const flowCookie = readCookie(req, OAUTH_COOKIE);
  const flowJson = flowCookie ? await decrypt(flowCookie).catch(() => null) : null;
  if (!flowJson) return fail("state_missing");

  let flow: { s: string; v: string; r: string; e: number };
  try {
    flow = JSON.parse(flowJson);
  } catch {
    return fail("state_missing");
  }
  if (Date.now() > flow.e) return fail("flow_expired");
  if (!safeEqual(flow.s, returnedState)) return fail("state_mismatch");

  const redirectUri = getRedirectUri(req);
  if (flow.r !== redirectUri) return fail("redirect_mismatch");

  // 2. Backend token exchange (public client + PKCE; Deriv issues no client secret).
  const appId = getAppId()!;
  let tokenBody: { access_token?: string; expires_in?: number; token_type?: string; scope?: string };
  try {
    const res = await fetch(DERIV_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: appId,
        code,
        code_verifier: flow.v,
        redirect_uri: redirectUri,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      // Log only the status & error code returned by Deriv — never the code/token.
      let errCode = "unknown";
      try {
        errCode = String(((await res.json()) as { error?: string }).error ?? "unknown");
      } catch {
        /* ignore */
      }
      console.warn(`Deriv token exchange failed: HTTP ${res.status} (${errCode})`);
      return fail(errCode === "invalid_client" ? "invalid_client" : "token_exchange_failed");
    }
    tokenBody = await res.json();
  } catch {
    return fail("token_exchange_failed");
  }

  if (!tokenBody.access_token || (tokenBody.token_type && tokenBody.token_type.toLowerCase() !== "bearer")) {
    return fail("token_exchange_failed");
  }

  // 3. Read-only account lookup for the status display (non-fatal if it fails).
  const accountsResult = await fetchAccounts(tokenBody.access_token, appId);

  // 4. Store the token server-side and issue the session cookie.
  await deleteSessionFromRequest(req).catch(() => undefined);
  await purgeExpiredSessions().catch(() => undefined);
  let sessionCookie: string;
  try {
    sessionCookie = await createSession({
      accessToken: tokenBody.access_token,
      // Store the real lifetime Deriv sent; don't hardcode it.
      expiresIn: Number(tokenBody.expires_in ?? 3600),
      scope: tokenBody.scope ?? "trade",
      accounts: accountsResult.ok ? accountsResult.accounts : null,
      secure,
    });
  } catch (err) {
    console.error("Failed to store Deriv session:", err instanceof Error ? err.message : "unknown");
    return fail("storage_unavailable");
  }

  return redirect("/?deriv=connected", [clearFlow, sessionCookie], noReferrer);
};

export const config: Config = {
  path: "/auth/deriv/callback",
  method: "GET",
};
