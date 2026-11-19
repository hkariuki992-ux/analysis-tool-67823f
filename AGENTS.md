# AGENTS.md

Read PLAN.md for what is done and what remains.

## Architecture
- `netlify/functions/`: Deriv OAuth (`deriv-login`, `deriv-callback` at `/auth/deriv/callback`, `deriv-status`, `deriv-logout`). The existing backend lives here, so keep using Functions.
- `netlify/lib/`: config (endpoints, scopes), crypto (AES-GCM, PKCE), http helpers, sessions.
- `db/schema.ts` and `netlify/database/migrations/`: the `deriv_sessions` table. Every schema change needs a migration (`npx drizzle-kit generate --name ...`).
- `src/feed/`: the multiplexed WebSocket feed (Deriv public socket, max 6 requests in flight to avoid RateLimit; history pages are 1,000 ticks).
- `src/engine/`: pure analysis (`analyze`, `settle`).
- `src/components/`: UI.

## Non-obvious decisions
- Scope is `trade` only. Deriv has no read-only scope, and `GET /trading/v1/options/accounts` requires `trade`. Never call buy/sell, and never request `payment` or `account_manage`.
- Deriv issues no refresh tokens. On expiry or a 401, the session is deleted and the user reconnects.
- Tokens are encrypted and stored server-side. The browser only holds an httpOnly session id, and the database stores its hash.
- PKCE and state go in an encrypted httpOnly cookie scoped to `/auth/deriv`.
- Synthetic indices come from an RNG. The UI shows honest baselines and z-scores rather than claimed accuracy.
