/**
 * Deriv OAuth 2.0 configuration (server-side only).
 *
 * Source: https://developers.deriv.com/docs/intro/oauth/ and the Deriv
 * OpenAPI spec (https://developers.deriv.com/data/production-openapi.json).
 */

export const DERIV_AUTHORIZE_URL = "https://auth.deriv.com/oauth2/auth";
export const DERIV_TOKEN_URL = "https://auth.deriv.com/oauth2/token";
export const DERIV_API_BASE = "https://api.derivws.com";

/**
 * Scopes requested from Deriv. Verified against the OpenAPI spec:
 *
 *   GET /trading/v1/options/accounts  -> requires `trade`
 *
 * Deriv offers no read-only scope for account data, so `trade` is the
 * minimum scope that lets us show the connected account list and balances.
 * This app NEVER calls any buy/sell/contract endpoint.
 *
 * Deliberately NOT requested:
 *   - `account_manage` (creates/manages accounts; not needed)
 *   - `payment`        (payment-agent deposits & withdrawals; forbidden)
 *   - `application_read` (partner/app statistics; not needed)
 */
export const DERIV_SCOPES = ["trade"] as const;

export const CALLBACK_PATH = "/auth/deriv/callback";

export const SESSION_COOKIE = "bs_session";
export const OAUTH_COOKIE = "bs_oauth";
/** How long a user has to finish the Deriv login screen. */
export const OAUTH_FLOW_TTL_MS = 10 * 60 * 1000;

export function getAppId(): string | undefined {
  const v = process.env.DERIV_APP_ID?.trim();
  return v ? v : undefined;
}


/**
 * The redirect URI must exactly match what is registered on Deriv.
 * Prefer the explicit env var; otherwise derive it from the request origin
 * (useful for `netlify dev` on http://localhost:8889).
 */
export function getRedirectUri(req: Request): string {
  const explicit = process.env.DERIV_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  return new URL(CALLBACK_PATH, new URL(req.url).origin).toString();
}

export function isConfigured(): boolean {
  return Boolean(getAppId());
}
