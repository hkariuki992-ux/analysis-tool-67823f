# Blue Scope Analysis Tool v2.4

A live digit and tick analysis dashboard for Deriv volatility indices, with Deriv OAuth account linking. It only analyses markets. It never places trades and never handles withdrawals.

**Stack:** React 19, Vite, Tailwind v4, Netlify Functions (OAuth), Netlify Database with Drizzle (encrypted token sessions), Netlify Blobs (fallback encryption key).

## Run locally
```
npm install
netlify dev --port 8889
```
For local OAuth testing, register `http://localhost:8889/auth/deriv/callback` on Deriv as well.

## Environment variables
- `DERIV_APP_ID` (required): the OAuth Client ID from Deriv.
- `DERIV_REDIRECT_URI` (optional): `https://analysis-tool-67823f.netlify.app/auth/deriv/callback`
- `TOKEN_ENCRYPTION_KEY` (optional): a base64 32-byte key. If it isn't set, a key is generated and kept in Netlify Blobs.
- `VITE_TICK_FEED_URL` (optional): the URL of your VPS tick relay.

## Roadmap
See [PLAN.md](PLAN.md).
