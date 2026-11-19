import type { Config } from "@netlify/functions";
import {
  DERIV_AUTHORIZE_URL,
  DERIV_SCOPES,
  OAUTH_COOKIE,
  OAUTH_FLOW_TTL_MS,
  getAppId,
  getRedirectUri,
  isConfigured,
} from "../lib/config.js";
import { createPkcePair, encrypt } from "../lib/crypto.js";
import { isSecureRequest, redirect, serializeCookie } from "../lib/http.js";

/**
 * "CONNECT DERIV" entry point.
 * Generates PKCE verifier/challenge + random state on the server, keeps them in
 * an encrypted httpOnly cookie scoped to /auth/deriv, then redirects to Deriv's
 * official authorization endpoint.
 */
export default async (req: Request) => {
  if (!isConfigured()) return redirect("/?deriv_error=not_configured");

  const url = new URL(req.url);
  const redirectUri = getRedirectUri(req);
  const { verifier, challenge } = createPkcePair();
  const state = crypto.getRandomValues(new Uint8Array(32)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "");

  let sealedFlow: string;
  try {
    sealedFlow = await encrypt(
      JSON.stringify({ s: state, v: verifier, r: redirectUri, e: Date.now() + OAUTH_FLOW_TTL_MS }),
    );
  } catch {
    return redirect("/?deriv_error=storage_unavailable");
  }

  const flowCookie = serializeCookie(
    OAUTH_COOKIE,
    sealedFlow,
    {
      path: "/auth/deriv",
      maxAge: OAUTH_FLOW_TTL_MS / 1000,
      // Lax is required: the cookie must ride along on Deriv's top-level redirect back.
      sameSite: "Lax",
      secure: isSecureRequest(req),
    },
  );

  const authorize = new URL(DERIV_AUTHORIZE_URL);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", getAppId()!);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("scope", DERIV_SCOPES.join(" "));
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  if (url.searchParams.get("signup") === "1") authorize.searchParams.set("prompt", "registration");

  return redirect(authorize.toString(), [flowCookie]);
};

export const config: Config = {
  path: "/auth/deriv/login",
  method: "GET",
};
