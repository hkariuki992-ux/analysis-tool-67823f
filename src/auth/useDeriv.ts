import { useCallback, useEffect, useState } from "react";

export type DerivAccount = {
  accountId: string;
  accountType: "demo" | "real";
  currency: string;
  balance: number;
  status: string;
  group: string;
};

export type DerivStatus =
  | { state: "loading" }
  | { state: "offline" }
  | {
      state: "not_configured" | "disconnected" | "expired" | "connected";
      redirectUri: string;
      scopes: string[];
      missing: string[];
      expiresAt?: string;
      accounts?: DerivAccount[];
      accountsError?: string | null;
    };

const ERROR_MESSAGES: Record<string, string> = {
  not_configured: "Deriv isn't configured yet. Add DERIV_APP_ID in your Netlify environment variables.",
  access_denied: "Connection cancelled on Deriv.",
  authorization_failed: "Deriv declined the authorization request.",
  missing_code: "Deriv returned without an authorization code. Please try again.",
  state_missing: "Your login session expired before Deriv returned. Please connect again.",
  flow_expired: "The login took longer than 10 minutes. Please connect again.",
  state_mismatch: "Security check failed (state mismatch). The connection was blocked.",
  redirect_mismatch: "The callback URL changed mid-login. Please connect again.",
  invalid_client: "Deriv rejected the App ID. Check DERIV_APP_ID.",
  token_exchange_failed: "Deriv's token exchange failed. Please try again.",
  storage_unavailable: "Secure token storage is unavailable right now. Please try again shortly.",
};

/** Reads and clears ?deriv / ?deriv_error left by the OAuth callback. */
export function consumeOAuthResult(): { kind: "success" | "error"; message: string } | null {
  const url = new URL(window.location.href);
  const ok = url.searchParams.get("deriv");
  const err = url.searchParams.get("deriv_error");
  if (!ok && !err) return null;
  url.searchParams.delete("deriv");
  url.searchParams.delete("deriv_error");
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  if (err) return { kind: "error", message: ERROR_MESSAGES[err] ?? "Deriv connection failed." };
  return { kind: "success", message: "Deriv account connected." };
}

export function useDeriv() {
  const [status, setStatus] = useState<DerivStatus>({ state: "loading" });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/deriv/status", { credentials: "same-origin", headers: { Accept: "application/json" } });
      if (!res.ok && res.status !== 503) throw new Error(String(res.status));
      const body = await res.json();
      const common = {
        redirectUri: body.redirectUri as string,
        scopes: (body.scopes as string[]) ?? ["trade"],
        missing: (body.missing as string[]) ?? [],
      };
      if (!body.configured) setStatus({ state: "not_configured", ...common });
      else if (body.connected)
        setStatus({
          state: "connected",
          ...common,
          expiresAt: body.expiresAt,
          accounts: body.accounts ?? [],
          accountsError: body.accountsError,
        });
      else if (body.reason === "expired") setStatus({ state: "expired", ...common });
      else setStatus({ state: "disconnected", ...common });
    } catch {
      setStatus({ state: "offline" });
    }
  }, []);

  useEffect(() => {
    refresh();
    // Re-check periodically so an expired/revoked token flips to "Reconnect".
    const t = window.setInterval(refresh, 5 * 60 * 1000);
    return () => window.clearInterval(t);
  }, [refresh]);

  const connect = useCallback(() => {
    window.location.assign("/auth/deriv/login");
  }, []);

  const disconnect = useCallback(async () => {
    await fetch("/api/deriv/logout", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
    await refresh();
  }, [refresh]);

  return { status, refresh, connect, disconnect };
}
