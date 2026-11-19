import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * Server-side Deriv OAuth sessions.
 *
 * - `id` is the SHA-256 hash of the random session id held in the browser's
 *   httpOnly cookie, so a database leak alone cannot be replayed as a cookie.
 * - `accessTokenEnc` is the Deriv access token encrypted with AES-256-GCM
 *   (key: TOKEN_ENCRYPTION_KEY). The plaintext token never leaves the server.
 */
export const derivSessions = pgTable("deriv_sessions", {
  id: text().primaryKey(),
  accessTokenEnc: text("access_token_enc").notNull(),
  scope: text().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  accounts: jsonb().$type<DerivAccountSummary[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
});

export type DerivAccountSummary = {
  accountId: string;
  accountType: "demo" | "real";
  currency: string;
  balance: number;
  status: string;
  group: string;
};
