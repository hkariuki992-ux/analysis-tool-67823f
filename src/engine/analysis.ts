import { argmax, argmin, chiSquarePValue, normalize, poissonCdf } from "./stats";

export type ContractFamily = "matches_differs" | "even_odd" | "over_under" | "rise_fall";
export type Duration = 1 | 2 | 3 | 4 | 5;

export const CONTRACTS: { id: ContractFamily; label: string; sides: [string, string] }[] = [
  { id: "matches_differs", label: "Matches / Differs", sides: ["Matches", "Differs"] },
  { id: "even_odd", label: "Even / Odd", sides: ["Even", "Odd"] },
  { id: "over_under", label: "Over / Under", sides: ["Over", "Under"] },
  { id: "rise_fall", label: "Rise / Fall", sides: ["Rise", "Fall"] },
];

export type AnalysisInput = {
  symbol: string;
  digits: number[];
  quotes: number[];
  contract: ContractFamily;
  duration: Duration;
  /** Barrier digit for Over/Under (0–9). */
  barrier: number;
};

export type Signal = "strong" | "moderate" | "weak" | "none";

export type AnalysisResult = {
  symbol: string;
  contract: ContractFamily;
  duration: Duration;
  barrier: number;
  sampleSize: number;
  computeMs: number;
  /** Ensemble probability of each last digit on the settlement tick. */
  distribution: number[];
  components: { gaussian: number[]; poisson: number[]; markov: number[] };
  frequency: number[];
  poissonZ: number[];
  poissonTail: number[];
  gaps: number[];
  chi2: { stat: number; p: number };
  predictedDigit: number;
  recommendation: { side: string; label: string; digit?: number; barrier?: number };
  /** Model probability of the recommended outcome (0–1). */
  probability: number;
  /** Probability under a fair, uniform RNG (0–1). */
  baseline: number;
  /** probability − baseline. */
  edge: number;
  /** Historical win rate of the recommendation across the sample at this horizon. */
  backtest: number;
  /** z-score of the backtest vs. baseline. */
  z: number;
  signal: Signal;
  sides: { label: string; probability: number; baseline: number }[];
  riseFall?: { empirical: number; markov: number; momentum: number };
};

const W_GAUSS = 0.4;
const W_POISSON = 0.25;
const W_MARKOV = 0.35;

/** Gaussian recency filter + Dirichlet shrinkage toward uniform (noise suppression). */
function gaussianFilter(digits: number[]): number[] {
  const n = digits.length;
  const sigma = Math.max(50, n * 0.35);
  const acc = new Array(10).fill(0);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const age = n - 1 - i;
    const w = Math.exp(-(age * age) / (2 * sigma * sigma));
    acc[digits[i]] += w;
    total += w;
  }
  const alpha = 20;
  return acc.map((a) => (a + alpha * 0.1) / (total + alpha));
}

/** Poisson rate model over a short window, plus gap ("time since seen") tails. */
function poissonModel(digits: number[]) {
  const n = digits.length;
  const W = Math.min(n, 300);
  const lambda = W / 10;
  const counts = new Array(10).fill(0);
  for (let i = n - W; i < n; i++) counts[digits[i]]++;
  const z = counts.map((k) => (k - lambda) / Math.sqrt(lambda || 1));
  const tail = counts.map((k) => {
    const lower = poissonCdf(k, lambda);
    return Math.min(lower, 1 - poissonCdf(k - 1, lambda)) * 2;
  });
  const gaps = new Array(10).fill(n);
  for (let d = 0; d < 10; d++) {
    for (let i = n - 1; i >= 0; i--) {
      if (digits[i] === d) {
        gaps[d] = n - 1 - i;
        break;
      }
    }
  }
  return { dist: normalize(counts.map((k) => k + 1)), z, tail: tail.map((t) => Math.min(1, t)), gaps };
}

/** First-order Markov chain over last digits, propagated `k` steps ahead. */
function markovModel(digits: number[], k: number): number[] {
  const T = Array.from({ length: 10 }, () => new Array(10).fill(1));
  for (let i = 1; i < digits.length; i++) T[digits[i - 1]][digits[i]]++;
  const M = T.map((row) => normalize(row));
  let v = new Array(10).fill(0);
  v[digits[digits.length - 1] ?? 0] = 1;
  for (let step = 0; step < k; step++) {
    const next = new Array(10).fill(0);
    for (let i = 0; i < 10; i++) {
      if (!v[i]) continue;
      for (let j = 0; j < 10; j++) next[j] += v[i] * M[i][j];
    }
    v = next;
  }
  return v;
}

function riseFallModel(quotes: number[], k: number) {
  const n = quotes.length;
  let rises = 0;
  let falls = 0;
  for (let i = 0; i + k < n; i++) {
    if (quotes[i + k] > quotes[i]) rises++;
    else if (quotes[i + k] < quotes[i]) falls++;
  }
  const windows = Math.max(1, n - k);
  const empirical = rises / windows;
  const empiricalFall = falls / windows;

  // Two-state Markov chain on tick direction, propagated k steps via DP on net moves.
  let uu = 1, ud = 1, du = 1, dd = 1;
  let last = 0;
  for (let i = 2; i < n; i++) {
    const a = Math.sign(quotes[i - 1] - quotes[i - 2]);
    const b = Math.sign(quotes[i] - quotes[i - 1]);
    if (!a || !b) continue;
    if (a > 0 && b > 0) uu++;
    else if (a > 0) ud++;
    else if (b > 0) du++;
    else dd++;
  }
  for (let i = n - 1; i > 0 && !last; i--) last = Math.sign(quotes[i] - quotes[i - 1]);
  const pUp = { up: uu / (uu + ud), down: du / (du + dd) };
  let states = new Map<string, number>([[`${last >= 0 ? 1 : -1}|0`, 1]]);
  for (let s = 0; s < k; s++) {
    const next = new Map<string, number>();
    for (const [key, p] of states) {
      const [dir, net] = key.split("|").map(Number);
      const up = dir > 0 ? pUp.up : pUp.down;
      const kUp = `1|${net + 1}`;
      const kDn = `-1|${net - 1}`;
      next.set(kUp, (next.get(kUp) ?? 0) + p * up);
      next.set(kDn, (next.get(kDn) ?? 0) + p * (1 - up));
    }
    states = next;
  }
  let markov = 0;
  let markovFall = 0;
  for (const [key, p] of states) {
    const net = Number(key.split("|")[1]);
    if (net > 0) markov += p;
    else if (net < 0) markovFall += p;
  }

  // Gaussian-smoothed momentum over the most recent 60 ticks.
  const recent = quotes.slice(-60);
  const sigma = 4;
  const smooth = recent.map((_, i) => {
    let s = 0, w = 0;
    for (let j = Math.max(0, i - 12); j <= Math.min(recent.length - 1, i + 12); j++) {
      const g = Math.exp(-((i - j) ** 2) / (2 * sigma * sigma));
      s += g * recent[j];
      w += g;
    }
    return s / w;
  });
  const inc = recent.slice(1).map((q, i) => q - recent[i]);
  const sd = Math.sqrt(inc.reduce((a, b) => a + b * b, 0) / Math.max(1, inc.length)) || 1;
  const slope = smooth.length > 10 ? (smooth[smooth.length - 1] - smooth[smooth.length - 11]) / 10 / sd : 0;
  const momentum = 0.5 + (1 / (1 + Math.exp(-slope * 2)) - 0.5) * 0.5;

  // Ties (exit == entry) lose both Rise and Fall, so momentum is scaled by the non-tie share.
  const nonTie = empirical + empiricalFall;
  const pRise = 0.45 * empirical + 0.35 * markov + 0.2 * momentum * nonTie;
  const pFall = 0.45 * empiricalFall + 0.35 * markovFall + 0.2 * (1 - momentum) * nonTie;
  return { pRise, pFall, empirical, empiricalFall, markov, momentum, windows };
}

function gradeSignal(z: number, edge: number): Signal {
  if (edge <= 0) return "none";
  if (z >= 3) return "strong";
  if (z >= 2) return "moderate";
  if (z >= 1) return "weak";
  return "none";
}

/** Fraction of horizon-k settlement digits in the sample that satisfy `win`. */
function backtestDigits(digits: number[], k: number, win: (d: number) => boolean) {
  let hits = 0;
  let n = 0;
  for (let i = 0; i + k < digits.length; i++) {
    n++;
    if (win(digits[i + k])) hits++;
  }
  return { rate: n ? hits / n : 0, n };
}

export function analyze(input: AnalysisInput): AnalysisResult {
  const t0 = performance.now();
  const { digits, quotes, contract, duration, symbol } = input;
  const barrier = Math.min(9, Math.max(0, input.barrier));
  const n = digits.length;

  const freq = new Array(10).fill(0);
  for (const d of digits) freq[d]++;
  const frequency = freq.map((c) => c / Math.max(1, n));
  const expected = n / 10;
  const chiStat = freq.reduce((a, c) => a + (c - expected) ** 2 / Math.max(expected, 1e-9), 0);

  const gaussian = gaussianFilter(digits);
  const pois = poissonModel(digits);
  const markov = markovModel(digits, duration);
  const distribution = normalize(gaussian.map((g, d) => W_GAUSS * g + W_POISSON * pois.dist[d] + W_MARKOV * markov[d]));
  const predictedDigit = argmax(distribution);

  let recommendation: AnalysisResult["recommendation"];
  let probability: number;
  let baseline: number;
  let win: (d: number) => boolean;
  let sides: AnalysisResult["sides"];
  let riseFall: AnalysisResult["riseFall"];
  let bt: { rate: number; n: number };

  if (contract === "matches_differs") {
    const hi = predictedDigit;
    const lo = argmin(distribution);
    const matchEdge = distribution[hi] - 0.1;
    const differsEdge = 0.1 - distribution[lo];
    sides = [
      { label: `Matches ${hi}`, probability: distribution[hi], baseline: 0.1 },
      { label: `Differs ${lo}`, probability: 1 - distribution[lo], baseline: 0.9 },
    ];
    if (matchEdge >= differsEdge) {
      recommendation = { side: "Matches", label: `MATCHES ${hi}`, digit: hi };
      probability = distribution[hi];
      baseline = 0.1;
      win = (d) => d === hi;
    } else {
      recommendation = { side: "Differs", label: `DIFFERS ${lo}`, digit: lo };
      probability = 1 - distribution[lo];
      baseline = 0.9;
      win = (d) => d !== lo;
    }
    bt = backtestDigits(digits, duration, win);
  } else if (contract === "even_odd") {
    const even = distribution.filter((_, d) => d % 2 === 0).reduce((a, b) => a + b, 0);
    sides = [
      { label: "Even", probability: even, baseline: 0.5 },
      { label: "Odd", probability: 1 - even, baseline: 0.5 },
    ];
    const isEven = even >= 0.5;
    recommendation = { side: isEven ? "Even" : "Odd", label: isEven ? "EVEN" : "ODD" };
    probability = isEven ? even : 1 - even;
    baseline = 0.5;
    win = (d) => (d % 2 === 0) === isEven;
    bt = backtestDigits(digits, duration, win);
  } else if (contract === "over_under") {
    const over = distribution.filter((_, d) => d > barrier).reduce((a, b) => a + b, 0);
    const under = distribution.filter((_, d) => d < barrier).reduce((a, b) => a + b, 0);
    const overBase = (9 - barrier) / 10;
    const underBase = barrier / 10;
    sides = [
      { label: `Over ${barrier}`, probability: over, baseline: overBase },
      { label: `Under ${barrier}`, probability: under, baseline: underBase },
    ];
    // Deriv allows Over 0–8 and Under 1–9.
    const canOver = barrier <= 8;
    const canUnder = barrier >= 1;
    const pickOver = canOver && (!canUnder || over - overBase >= under - underBase);
    recommendation = { side: pickOver ? "Over" : "Under", label: `${pickOver ? "OVER" : "UNDER"} ${barrier}`, barrier };
    probability = pickOver ? over : under;
    baseline = pickOver ? overBase : underBase;
    win = pickOver ? (d) => d > barrier : (d) => d < barrier;
    bt = backtestDigits(digits, duration, win);
  } else {
    const rf = riseFallModel(quotes, duration);
    const isRise = rf.pRise >= rf.pFall;
    sides = [
      { label: "Rise", probability: rf.pRise, baseline: 0.5 },
      { label: "Fall", probability: rf.pFall, baseline: 0.5 },
    ];
    recommendation = { side: isRise ? "Rise" : "Fall", label: isRise ? "RISE" : "FALL" };
    probability = isRise ? rf.pRise : rf.pFall;
    baseline = 0.5;
    win = () => false;
    bt = { rate: isRise ? rf.empirical : rf.empiricalFall, n: rf.windows };
    riseFall = { empirical: rf.empirical, markov: rf.markov, momentum: rf.momentum };
  }

  const se = Math.sqrt((baseline * (1 - baseline)) / Math.max(1, bt.n));
  const z = (bt.rate - baseline) / (se || 1);
  const edge = probability - baseline;

  return {
    symbol,
    contract,
    duration,
    barrier,
    sampleSize: n,
    computeMs: Math.round((performance.now() - t0) * 10) / 10,
    distribution,
    components: { gaussian, poisson: pois.dist, markov },
    frequency,
    poissonZ: pois.z,
    poissonTail: pois.tail,
    gaps: pois.gaps,
    chi2: { stat: chiStat, p: chiSquarePValue(chiStat, 9) },
    predictedDigit,
    recommendation,
    probability,
    baseline,
    edge,
    backtest: bt.rate,
    z,
    signal: gradeSignal(z, edge),
    sides,
    riseFall,
  };
}

/** Did a recommendation win, given the settlement tick? */
export function settle(
  result: Pick<AnalysisResult, "contract" | "recommendation" | "barrier">,
  entryQuote: number,
  exitQuote: number,
  exitDigit: number,
): boolean {
  const r = result.recommendation;
  switch (result.contract) {
    case "matches_differs":
      return r.side === "Matches" ? exitDigit === r.digit : exitDigit !== r.digit;
    case "even_odd":
      return r.side === "Even" ? exitDigit % 2 === 0 : exitDigit % 2 === 1;
    case "over_under":
      return r.side === "Over" ? exitDigit > result.barrier : exitDigit < result.barrier;
    case "rise_fall":
      return r.side === "Rise" ? exitQuote > entryQuote : exitQuote < entryQuote;
  }
}
