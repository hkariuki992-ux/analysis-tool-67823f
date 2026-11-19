# Blue Scope Analysis Tool v2.4: Plan

1. ✅ Deriv OAuth backend: callback route, login with PKCE and state, token exchange, encrypted token storage in the database, status, disconnect, and handling for expired tokens.
2. ✅ Live tick feed: 12 volatility streams over Deriv's public socket, with fast loading of 10,000 ticks per market (rate-limit aware).
3. ✅ Analysis engine: Gaussian filter, Poisson model, Markov chain, significance tests; Matches/Differs, Even/Odd, Over/Under, Rise/Fall; 1–5 ticks.
4. ✅ UI: Connect Deriv control, live spot ticker, market contracts deck, Neural Engine panel with the digit radar and a 10-second prediction countdown.
5. ⬜ Automated volatility scanner: a "Scan all volatility streams" button that ranks all 12 assets, and wiring for the "AI auto" asset mode.
6. ⬜ Prediction log: settle each prediction against the live tick and show the real hit rate.
7. ⬜ VPS tick relay (`relay/`): a lightweight Node script for a VPS near Deriv's endpoint; the frontend reads it through `VITE_TICK_FEED_URL`.
8. ⬜ End-to-end OAuth test once the Deriv App ID is set, then deploy after approval.
