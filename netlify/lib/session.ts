import { eq, lt } from "drizzle-orm";
import { db } from "../../db/index.js";
import { derivSessions, type DerivAccountSummary } from "../../db/schema.js";
import { DERIV_API_BASE, SESSION_COOKIE } from "./config.js";
import { decrypt, encrypt, randomToken, sha256Hex } from "./crypto.js";
import { clearCookie, readCookie, serializeCookie } from "./http.js";

export type SessionRow = typeof derivSessions.$inferSelect;

/** Max cookie lifetime; Deriv currently issues ~30-day tokens. */
const MAX_SESSION_SECONDS = 60 * 60 * 24 * 30;

export async function createSession(input: {
  accessToken: string;
  expiresIn: number;
  scope: string;
  accounts: DerivAccountSummary[] | null;
  secure: boolean;
}): Promise<string> {
  const sessionId = randomToken(32);
  const lifetime = Math.min(Math.max(60, input.expiresIn), MAX_SESSION_SECONDS);
  await db.insert(derivSessions).values({
    id: sha256Hex(sessionId),
    accessTokenEnc: await encrypt(input.accessToken),
    scope: input.scope,
    expiresAt: new Date(Date.now() + lifetime * 1000),
    accounts: input.accounts,
  });
  return serializeCookie(SESSION_COOKIE, sessionId, {
    path: "/",
    maxAge: lifetime,
    secure: input.secure,
  });
}

export async function loadSession(req: Request): Promise<SessionRow | null> {
  const sessionId = readCookie(req, SESSION_COOKIE);
  if (!sessionId) return null;
  const rows = await db
    .select()
    .from(derivSessions)
    .where(eq(derivSessions.id, sha256Hex(sessionId)))
    .limit(1);
  return rows[0] ?? null;
}

export function getAccessToken(row: SessionRow): Promise<string | null> {
  return decrypt(row.accessTokenEnc);
}

export async function deleteSession(row: SessionRow | null): Promise<void> {
  if (!row) return;
  await db.delete(derivSessions).where(eq(derivSessions.id, row.id));
}

export async function deleteSessionFromRequest(req: Request): Promise<void> {
  const sessionId = readCookie(req, SESSION_COOKIE);
  if (!sessionId) return;
  await db.delete(derivSessions).where(eq(derivSessions.id, sha256Hex(sessionId)));
}

export async function purgeExpiredSessions(): Promise<void> {
  await db.delete(derivSessions).where(lt(derivSessions.expiresAt, new Date()));
}

export async function updateAccounts(row: SessionRow, accounts: DerivAccountSummary[]): Promise<void> {
  await db
    .update(derivSessions)
    .set({ accounts, lastSeenAt: new Date() })
    .where(eq(derivSessions.id, row.id));
}

export function clearSessionCookie(secure: boolean): string {
  return clearCookie(SESSION_COOKIE, "/", secure);
}

export type AccountsResult =
  | { ok: true; accounts: DerivAccountSummary[] }
  | { ok: false; status: number; reason: "unauthorized" | "insufficient_scope" | "upstream_error" };

/**
 * Read-only call: GET /trading/v1/options/accounts (scope: trade).
 * This is the ONLY Deriv API call the backend makes with the user's token.
 */
export async function fetchAccounts(accessToken: string, appId: string): Promise<AccountsResult> {
  try {
    const res = await fetch(`${DERIV_API_BASE}/trading/v1/options/accounts`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        // Marked required in Deriv's OpenAPI spec; harmless for OAuth tokens.
        "Deriv-App-ID": appId,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 401) return { ok: false, status: 401, reason: "unauthorized" };
    if (res.status === 403) return { ok: false, status: 403, reason: "insufficient_scope" };
    if (!res.ok) return { ok: false, status: res.status, reason: "upstream_error" };
    const body = (await res.json()) as { data?: Array<Record<string, unknown>> };
    const accounts: DerivAccountSummary[] = (body.data ?? []).map((a) => ({
      accountId: String(a.account_id ?? ""),
      accountType: a.account_type === "real" ? "real" : "demo",
      currency: String(a.currency ?? ""),
      balance: typeof a.balance === "number" ? a.balance : Number(a.balance ?? 0),
      status: String(a.status ?? ""),
      group: String(a.group ?? ""),
    }));
    return { ok: true, accounts };
  } catch {
    return { ok: false, status: 0, reason: "upstream_error" };
  }
}
