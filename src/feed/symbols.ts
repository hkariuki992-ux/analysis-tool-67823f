/** The 12 Deriv volatility streams covered by the automated scanner. */
export type AssetDef = {
  symbol: string;
  name: string;
  short: string;
  /** Decimal places used to read the last digit (refreshed from the feed's pip_size). */
  decimals: number;
};

export const ASSETS: AssetDef[] = [
  { symbol: "R_10", name: "Volatility 10 Index", short: "V10", decimals: 3 },
  { symbol: "R_25", name: "Volatility 25 Index", short: "V25", decimals: 3 },
  { symbol: "R_50", name: "Volatility 50 Index", short: "V50", decimals: 4 },
  { symbol: "R_75", name: "Volatility 75 Index", short: "V75", decimals: 4 },
  { symbol: "R_100", name: "Volatility 100 Index", short: "V100", decimals: 2 },
  { symbol: "1HZ10V", name: "Volatility 10 (1s) Index", short: "V10·1s", decimals: 2 },
  { symbol: "1HZ15V", name: "Volatility 15 (1s) Index", short: "V15·1s", decimals: 3 },
  { symbol: "1HZ25V", name: "Volatility 25 (1s) Index", short: "V25·1s", decimals: 2 },
  { symbol: "1HZ50V", name: "Volatility 50 (1s) Index", short: "V50·1s", decimals: 2 },
  { symbol: "1HZ75V", name: "Volatility 75 (1s) Index", short: "V75·1s", decimals: 2 },
  { symbol: "1HZ90V", name: "Volatility 90 (1s) Index", short: "V90·1s", decimals: 3 },
  { symbol: "1HZ100V", name: "Volatility 100 (1s) Index", short: "V100·1s", decimals: 2 },
];

export const ASSET_BY_SYMBOL = Object.fromEntries(ASSETS.map((a) => [a.symbol, a])) as Record<string, AssetDef>;

/** Public, unauthenticated Deriv market-data socket (no token ever used here). */
export const DERIV_PUBLIC_WS = "wss://api.derivws.com/trading/v1/options/ws/public";

/** Optional VPS relay (see /relay). Falls back to Deriv's public socket. */
export const FEED_URL: string = (import.meta.env.VITE_TICK_FEED_URL as string | undefined)?.trim() || DERIV_PUBLIC_WS;

export const MAX_TICKS = 10_000;
