import { useEffect, useState } from "react";
import type { AnalysisResult } from "../engine/analysis";
import { ASSET_BY_SYMBOL } from "../feed/symbols";
import { DigitRadar } from "./DigitRadar";

export type ActivePrediction = {
  id: string;
  createdAt: number;
  expiresAt: number;
  result: AnalysisResult;
};

type Props = {
  result: AnalysisResult | null;
  prediction: ActivePrediction | null;
  liveDigit: number | null;
  loadingLabel: string | null;
};

const HOLD_MS = 10_000;

const SIGNAL_STYLE: Record<AnalysisResult["signal"], { label: string; cls: string }> = {
  strong: { label: "Strong signal", cls: "text-hit border-hit/40 bg-hit/10" },
  moderate: { label: "Moderate signal", cls: "text-scope border-scope/40 bg-scope/10" },
  weak: { label: "Weak signal", cls: "text-amber border-amber/40 bg-amber/10" },
  none: { label: "No edge detected", cls: "text-mute border-line-2 bg-panel-2" },
};

function pct(v: number, d = 1) {
  return `${(v * 100).toFixed(d)}%`;
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(t);
  }, [active]);
  return now;
}

/** LIVE NEURAL ANALYSIS ENGINE v2.4.2.1 */
export function NeuralEngine({ result, prediction, liveDigit, loadingLabel }: Props) {
  const live = Boolean(prediction && prediction.expiresAt > Date.now());
  const now = useNow(live);
  const remaining = prediction ? Math.max(0, prediction.expiresAt - now) : 0;
  const frac = remaining / HOLD_MS;
  const r = result;
  const sig = r ? SIGNAL_STYLE[r.signal] : null;
  const RING = 2 * Math.PI * 54;

  return (
    <section className="panel overflow-hidden p-5" aria-labelledby="engine-title">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="label">06 · Live analysis engine</p>
          <h2 id="engine-title" className="font-display text-xl tracking-wide">
            Neural Analysis Engine <span className="text-scope">v2.4.2.1</span>
          </h2>
        </div>
        <span className="flex items-center gap-2 rounded-full border border-hit/30 bg-hit/10 px-3 py-1 text-xs text-hit">
          <span className="h-1.5 w-1.5 rounded-full bg-hit pulse-dot" /> Active · hydro scan
        </span>
      </header>

      <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="relative flex justify-center">
          <DigitRadar
            distribution={r?.distribution ?? null}
            frequency={r?.frequency ?? null}
            highlight={r?.recommendation.digit ?? r?.predictedDigit ?? null}
            liveDigit={liveDigit}
          />
          {loadingLabel && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="rounded-lg border border-line-2 bg-ink/85 px-3 py-2 text-sm text-phosphor">{loadingLabel}</span>
            </div>
          )}
        </div>

        <div>
          {!r ? (
            <div className="rounded-xl border border-dashed border-line-2 p-6 text-center">
              <p className="font-display text-lg">Awaiting first analysis</p>
              <p className="mt-1 text-sm text-mute">
                Pick a contract and duration, then press <span className="text-text">Execute analysis</span>, or run the volatility
                scanner. The engine pulls up to 10,000 ticks per market.
              </p>
            </div>
          ) : (
            <div className="rise-in" key={prediction?.id ?? "static"}>
              <p className="label">
                {ASSET_BY_SYMBOL[r.symbol]?.name ?? r.symbol} · {r.duration} tick{r.duration > 1 ? "s" : ""}
              </p>
              <div className="mt-2 flex items-center gap-5">
                {/* countdown ring around the predicted digit */}
                <div className="relative h-32 w-32 shrink-0">
                  <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden>
                    <circle cx="60" cy="60" r="54" fill="none" stroke="#1b2942" strokeWidth="6" />
                    <circle
                      cx="60"
                      cy="60"
                      r="54"
                      fill="none"
                      stroke={live ? "#5cb8e6" : "#2f6d94"}
                      strokeWidth="6"
                      strokeLinecap="round"
                      strokeDasharray={RING}
                      strokeDashoffset={RING * (1 - frac)}
                      style={{ transition: "stroke-dashoffset 0.1s linear" }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="num text-5xl leading-none font-bold text-phosphor">
                      {r.contract === "rise_fall" ? (r.recommendation.side === "Rise" ? "▲" : "▼") : (r.recommendation.digit ?? r.predictedDigit)}
                    </span>
                    <span className="num mt-1 text-[0.7rem] text-mute">{live ? `${(remaining / 1000).toFixed(1)}s` : "expired"}</span>
                  </div>
                </div>
                <div className="min-w-0">
                  <p className="font-display text-2xl tracking-wide">{r.recommendation.label}</p>
                  <p className="num mt-1 text-3xl text-scope">{pct(r.probability)}</p>
                  <p className="text-xs text-mute">
                    model probability · fair baseline <span className="num">{pct(r.baseline)}</span>
                  </p>
                  {sig && <span className={`mt-2 inline-block rounded-md border px-2 py-0.5 text-xs ${sig.cls}`}>{sig.label}</span>}
                </div>
              </div>

              <dl className="mt-5 grid grid-cols-3 gap-2 text-center">
                <Stat label="Edge" value={`${r.edge >= 0 ? "+" : ""}${(r.edge * 100).toFixed(2)} pp`} tone={r.edge > 0 ? "text-hit" : "text-miss"} />
                <Stat label="Backtest" value={pct(r.backtest, 2)} />
                <Stat label="z-score" value={r.z.toFixed(2)} />
                <Stat label="Sample" value={r.sampleSize.toLocaleString()} />
                <Stat label="χ² p-value" value={r.chi2.p.toFixed(3)} />
                <Stat label="Compute" value={`${r.computeMs} ms`} />
              </dl>
            </div>
          )}
        </div>
      </div>

      {r && (
        <div className="mt-6 border-t border-line pt-4">
          {r.contract === "rise_fall" && r.riseFall ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <ModelBar name="Empirical k-tick rises" value={r.riseFall.empirical} />
              <ModelBar name="Markov direction chain" value={r.riseFall.markov} />
              <ModelBar name="Gaussian momentum" value={r.riseFall.momentum} />
            </div>
          ) : (
            <DigitTable r={r} />
          )}
          <p className="mt-4 text-[0.72rem] leading-relaxed text-mute">
            How it works: Gaussian recency filtering (40%), a Poisson rate model on the last 300 ticks (25%) and a Markov
            transition chain projected {r.duration} step{r.duration > 1 ? "s" : ""} ahead (35%) are blended into one
            digit distribution. Deriv's synthetic indices come from a certified random number generator, so a reading near
            the fair baseline (χ² p-value well above 0.05) is normal. Use the live hit rate in the prediction log to judge
            any signal.
          </p>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-line bg-ink-2/60 px-2 py-2">
      <dt className="label text-[0.6rem]">{label}</dt>
      <dd className={`num mt-0.5 text-sm ${tone ?? ""}`}>{value}</dd>
    </div>
  );
}

function ModelBar({ name, value }: { name: string; value: number }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-mute">{name}</span>
        <span className="num">{pct(value)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full bg-scope" style={{ width: `${Math.min(100, value * 100)}%` }} />
      </div>
    </div>
  );
}

function DigitTable({ r }: { r: AnalysisResult }) {
  const max = Math.max(...r.distribution);
  return (
    <div className="overflow-x-auto">
      <table className="num w-full min-w-[34rem] text-xs">
        <thead>
          <tr className="text-mute">
            <th className="label py-1 text-left text-[0.6rem]">Digit</th>
            {r.distribution.map((_, d) => (
              <th key={d} className="py-1 font-medium">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <Row label="Ensemble" values={r.distribution.map((p) => pct(p))} emphasise={r.distribution.map((p) => p === max)} />
          <Row label="Gaussian" values={r.components.gaussian.map((p) => pct(p))} />
          <Row label="Poisson z" values={r.poissonZ.map((z) => (z >= 0 ? "+" : "") + z.toFixed(1))} />
          <Row label="Markov" values={r.components.markov.map((p) => pct(p))} />
          <Row label="Gap (ticks)" values={r.gaps.map((g) => String(g))} />
        </tbody>
      </table>
    </div>
  );
}

function Row({ label, values, emphasise }: { label: string; values: string[]; emphasise?: boolean[] }) {
  return (
    <tr className="border-t border-line/60">
      <td className="py-1.5 pr-2 font-sans text-mute">{label}</td>
      {values.map((v, i) => (
        <td key={i} className={`py-1.5 text-center ${emphasise?.[i] ? "font-bold text-phosphor" : ""}`}>
          {v}
        </td>
      ))}
    </tr>
  );
}
