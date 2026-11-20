
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
  distribution: number[];
  components: { gaussian: number[]; poisson: number[]; markov: number[] };
  frequency: number[];
  poissonZ: number[];
  poissonTail: number[];
  gaps: number[];
  chi2: { stat: number; p: number };
  predictedDigit: number;
  recommendation: { side: string; label: string; digit?: number; barrier?: number };
  probability: number;
  baseline: number;
  edge: number;
  backtest: number;
  z: number;
  signal: Signal;
  sides: { label: string; probability: number; baseline: number }[];
  riseFall?: { empirical: number; markov: number; momentum: number };
};

const W_GAUSS = 0.4;
const W_POISSON = 0.25;
const W_MARKOV = 0.35;

const MIN_TRAIN = 100;
const BT_LIMIT = 500;

/** Gaussian recency filter with shrinkage toward a uniform distribution. */
function gaussianFilter(digits: number[]): number[] {
  const n = digits.length;
  if (!n) return new Array(10).fill(0.1);

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
  return acc.map((a) => (a + alpha * 0.1) / (total + alpha);
}

/** Poisson counts over the most recent 300 observations. */
function poissonModel(digits: number[]) {
  const n = digits.length;
  const W = Math.min(n, 300);
  const lambda = Math.max(W / 10, 1e-9);
  const counts = new Array(10).fill(0);

  for (let i = n - W; i < n; i++) counts[digits[i]]++;

  const z = counts.map((k) => (k - lambda) / Math.sqrt(lambda));
  const tail = counts.map((k) => {
    const lower = poissonCdf(k, lambda);
    return Math.min(1, Math.min(lower, 1 - poissonCdf(k - 1, lambda)) * 2);
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

  return {
    dist: normalize(counts.map((k) => k + 1)),
    z,
    tail,
    gaps,
  };
}

/** First-order Markov chain over digits, propagated k steps. */
function markovModel(digits: number[], k: number): number[] {
  const T = Array.from({ length: 10 }, () => new Array(10).fill(1));

  for (let i = 1; i < digits.length; i++) {
    T[digits[i - 1]][digits[i]]++;
  }

  const M = T.map((row) => normalize(row));
  let v = new Array(10).fill(0);
  v[digits[digits.length - 1] ?? 0] = 1;

  for (let step = 0; step < k; step++) {
    const next = new Array(10).fill(0);
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 10; j++) next[j] += v[i] * M[i][j];
    }
    v = next;
  }

  return v;
}

/** Ensemble digit distribution using only the supplied observations. */
function digitForecast(digits: number[], duration: number) {
  const gaussian = gaussianFilter(digits);
  const pois = poissonModel(digits);
  const markov = markovModel(digits, duration);

  const distribution = normalize(
    gaussian.map((g, d) =>
      W_GAUSS * g + W_POISSON * pois.dist[d] + W_MARKOV * markov[d],
    ),
  );

  return { gaussian, pois, markov, distribution };
}

function riseFallModel(quotes: number[], k: number) {
  const n = quotes.length;
  let rises = 0;
  let falls = 0;
  let ties = 0;

  for (let i = 0; i + k < n; i++) {
    if (quotes[i + k] > quotes[i]) rises++;
    else if (quotes[i + k] < quotes[i]) falls++;
    else ties++;
  }

  const windows = Math.max(1, n - k);
  const empirical = rises / windows;
  const empiricalFall = falls / windows;
  const tieRate = ties / windows;
  const nonTie = empirical + empiricalFall;

  // Smoothed transition probabilities for tick direction.
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

  for (let i = n - 1; i > 0 && !last; i--) {
    last = Math.sign(quotes[i] - quotes[i - 1]);
  }

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

  let markovRise = 0;
  let markovFall = 0;

  for (const [key, p] of states) {
    const net = Number(key.split("|")[1]);
    if (net > 0) markovRise += p;
    else if (net < 0) markovFall += p;
  }

  // Smooth momentum on recent quotes.
  const recent = quotes.slice(-60);
  const sigma = 4;

  const smooth = recent.map((_, i) => {
    let s = 0, w = 0;
    for (let j = Math.max(0, i - 12); j <= Math.min(recent.length - 1, i + 12); j++) {
      const g = Math.exp(-((i - j) ** 2) / (2 * sigma * sigma));
      s += g * recent[j];
      w += g;
    }
    return s / Math.max(w, 1e-12);
  });

  const inc = recent.slice(1).map((q, i) => q - recent[i]);
  const sd = Math.sqrt(inc.reduce((a, b) => a + b * b, 0) / Math.max(1, inc.length)) || 1;

  const slope = smooth.length > 10
    ? (smooth[smooth.length - 1] - smooth[smooth.length - 11]) / 10 / sd
    : 0;

  const momentum = 0.5 + (1 / (1 + Math.exp(-slope * 2)) - 0.5) * 0.5;

  // Model rise/fall probabilities retain tie probability.
  const pRise =
    0.45 * empirical +
    0.35 * markovRise * nonTie +
    0.2 * momentum * nonTie;

  const pFall =
    0.45 * empiricalFall +
    0.35 * markovFall * nonTie +
    0.2 * (1 - momentum) * nonTie;

  return {
    pRise: Math.max(0, Math.min(1, pRise)),
    pFall: Math.max(0, Math.min(1, pFall)),
    empirical,
    empiricalFall,
    markov: markovRise,
    momentum,
    tieRate,
    windows,
  };
}

/** Confidence is deliberately conservative because overlapping outcomes are dependent. */
function gradeSignal(z: number, edge: number): Signal {
  if (edge <= 0 || z < 1.5) return "none";
  if (z >= 4) return "strong";
  if (z >= 3) return "moderate";
  return "weak";
}

type BTResult = { rate: number; n: number; baseline: number };

/**
 * Walk-forward backtest.
 * Each forecast uses only the prefix available before its settlement.
 * This avoids using the final sample to choose historical predictions.
 */
function walkForwardBacktest(
  input: AnalysisInput,
  barrier: number,
): BTResult {
  const { digits, quotes, contract, duration } = input;
  const end = digits.length - duration;

  if (end <= MIN_TRAIN) return { rate: 0, n: 0, baseline: 0 };

  const start = Math.max(MIN_TRAIN, end - BT_LIMIT);
  let hits = 0;
  let tests = 0;
  let expectedBaseline = 0;

  for (let i = start; i < end; i++) {
    const prefix = digits.slice(0, i);
    const forecast = digitForecast(prefix, duration).distribution;
    const outcome = digits[i + duration];

    let predictedWin = false;
    let fairBaseline = 0.5;

    if (contract === "matches_differs") {
      const hi = argmax(forecast);
      const lo = argmin(forecast);
      const matchEdge = forecast[hi] - 0.1;
      const differsEdge = 0.1 - forecast[lo];

      if (matchEdge >= differsEdge) {
        predictedWin = outcome === hi;
        fairBaseline = 0.1;
      } else {
        predictedWin = outcome !== lo;
        fairBaseline = 0.9;
      }
    } else if (contract === "even_odd") {
      const even = forecast.filter((_, d) => d % 2 === 0).reduce((a, b) => a + b, 0);
      const pickEven = even >= 0.5;
      predictedWin = (outcome % 2 === 0) === pickEven;
      fairBaseline = 0.5;
    } else if (contract === "over_under") {
      const over = forecast.filter((_, d) => d > barrier).reduce((a, b) => a + b, 0);
      const under = forecast.filter((_, d) => d < barrier).reduce((a, b) => a + b, 0);
      const overBase = (9 - barrier) / 10;
      const underBase = barrier / 10;
      const canOver = barrier <= 8;
      const canUnder = barrier >= 1;
      const pickOver = canOver && (!canUnder || over - overBase >= under - underBase);

      predictedWin = pickOver ? outcome > barrier : outcome < barrier;
      fairBaseline = pickOver ? overBase : underBase;
    } else {
      const rf = riseFallModel(quotes.slice(0, i + 1), duration);
      const pickRise = rf.pRise >= rf.pFall;
      const exitQuote = quotes[i + duration];
      const entryQuote = quotes[i];

      predictedWin = pickRise ? exitQuote > entryQuote : exitQuote < entryQuote;
      fairBaseline = 0.5 * (1 - rf.tieRate);
    }

    if (predictedWin) hits++;
    expectedBaseline += fairBaseline;
    tests++;
  }

  return {
    rate: tests ? hits / tests : 0,
    n: tests,
    baseline: tests ? expectedBaseline / tests : 0,
  };
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

  const model = digitForecast(digits, duration);
  const { gaussian, pois, markov, distribution } = model;
  const predictedDigit = argmax(distribution);

  let recommendation: AnalysisResult["recommendation"];
  let probability: number;
  let baseline: number;
  let sides: AnalysisResult["sides"];
  let riseFall: AnalysisResult["riseFall"];

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
    } else {
      recommendation = { side: "Differs", label: `DIFFERS ${lo}`, digit: lo };
      probability = 1 - distribution[lo];
      baseline = 0.9;
    }
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
  } else if (contract === "over_under") {
    const over = distribution.filter((_, d) => d > barrier).reduce((a, b) => a + b, 0);
    const under = distribution.filter((_, d) => d < barrier).reduce((a, b) => a + b, 0);

    // Correct fair probabilities for a uniform 0–9 digit.
    const overBase = (9 - barrier) / 10;
    const underBase = barrier / 10;

    sides = [
      { label: `Over ${barrier}`, probability: over, baseline: overBase },
      { label: `Under ${barrier}`, probability: under, baseline: underBase },
    ];

    const canOver = barrier <= 8;
    const canUnder = barrier >= 1;
    const pickOver = canOver && (!canUnder || over - overBase >= under - underBase);

    recommendation = {
      side: pickOver ? "Over" : "Under",
      label: `${pickOver ? "OVER" : "UNDER"} ${barrier}`,
      barrier,
    };
    probability = pickOver ? over : under;
    baseline = pickOver ? overBase : underBase;
  } else {
    const rf = riseFallModel(quotes, duration);
    const isRise = rf.pRise >= rf.pFall;

    const fairRiseFallBaseline = 0.5 * (1 - rf.tieRate);

    sides = [
      { label: "Rise", probability: rf.pRise, baseline: fairRiseFallBaseline },
      { label: "Fall", probability: rf.pFall, baseline: fairRiseFallBaseline },
    ];

    recommendation = { side: isRise ? "Rise" : "Fall", label: isRise ? "RISE" : "FALL" };
    probability = isRise ? rf.pRise : rf.pFall;
    baseline = fairRiseFallBaseline;

    riseFall = { empirical: rf.empirical, markov: rf.markov, momentum: rf.momentum };
  }

  // Walk-forward test: no historical forecast is selected using the full sample.
  const bt = walkForwardBacktest(input, barrier);

  // Overlapping duration outcomes are correlated; reduce the effective sample
  // size before calculating a diagnostic z-score.
  const effectiveN = Math.max(1, Math.floor(bt.n / Math.max(1, duration)));
  const btBaseline = bt.baseline || baseline;
  const se = Math.sqrt((btBaseline * (1 - btBaseline)) / effectiveN);
  const z = bt.n ? (bt.rate - btBaseline) / (se || 1) : 0;
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

/** Check whether a recommendation won for a settlement. */
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
