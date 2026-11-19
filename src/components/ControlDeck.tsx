import { ASSETS } from "../feed/symbols";
import { CONTRACTS, type ContractFamily, type Duration } from "../engine/analysis";

type Props = {
  symbol: string;
  setSymbol: (s: string) => void;
  contract: ContractFamily;
  setContract: (c: ContractFamily) => void;
  barrier: number;
  setBarrier: (b: number) => void;
  duration: Duration;
  setDuration: (d: Duration) => void;
  autoSelect: boolean;
  setAutoSelect: (v: boolean) => void;
  onExecute: () => void;
  busy: boolean;
  feedReady: boolean;
};

const DURATIONS: Duration[] = [1, 2, 3, 4, 5];

export function ControlDeck(p: Props) {
  return (
    <section className="panel flex flex-col gap-5 p-5" aria-labelledby="deck-title">
      <header className="flex items-baseline justify-between">
        <h2 id="deck-title" className="font-display text-lg tracking-wide">
          Market contracts
        </h2>
        <span className="label">04</span>
      </header>

      {/* Asset: AI auto-select or manual */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="label">Asset</span>
          <div role="radiogroup" aria-label="Asset selection mode" className="flex rounded-lg border border-line p-0.5 text-xs">
            {[
              { v: true, l: "AI auto" },
              { v: false, l: "Manual" },
            ].map((o) => (
              <button
                key={o.l}
                role="radio"
                aria-checked={p.autoSelect === o.v}
                onClick={() => p.setAutoSelect(o.v)}
                className={`rounded-md px-2.5 py-1 font-display tracking-wider uppercase transition-colors ${
                  p.autoSelect === o.v ? "bg-scope/20 text-phosphor" : "text-mute hover:text-text"
                }`}
              >
                {o.l}
              </button>
            ))}
          </div>
        </div>
        <select
          value={p.symbol}
          onChange={(e) => p.setSymbol(e.target.value)}
          disabled={p.autoSelect}
          className="w-full rounded-[10px] border border-line-2 bg-ink-2 px-3 py-2.5 text-sm disabled:opacity-60"
          aria-label="Manual asset"
        >
          {ASSETS.map((a) => (
            <option key={a.symbol} value={a.symbol}>
              {a.name} ({a.symbol})
            </option>
          ))}
        </select>
        {p.autoSelect && (
          <p className="mt-1.5 text-xs text-mute">The engine picks the stream with the strongest signal from the latest scan.</p>
        )}
      </div>

      {/* Contract type */}
      <div>
        <span className="label mb-2 block">Contract type</span>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Contract type">
          {CONTRACTS.map((c) => (
            <button
              key={c.id}
              role="radio"
              aria-checked={p.contract === c.id}
              onClick={() => p.setContract(c.id)}
              className={`rounded-[10px] border px-3 py-2.5 text-left transition-all ${
                p.contract === c.id
                  ? "border-scope/70 bg-scope/10 shadow-[0_0_0_1px_var(--color-scope-dim)_inset]"
                  : "border-line hover:border-line-2 hover:bg-panel-2"
              }`}
            >
              <span className="block font-display text-sm tracking-wide">{c.label}</span>
              <span className="text-[0.7rem] text-mute">{c.id === "rise_fall" ? "Exit vs entry spot" : "Last digit of exit tick"}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Barrier */}
      {p.contract === "over_under" && (
        <div className="rise-in">
          <span className="label mb-2 block">Barrier digit</span>
          <div className="grid grid-cols-10 gap-1" role="radiogroup" aria-label="Barrier digit">
            {Array.from({ length: 10 }, (_, d) => (
              <button
                key={d}
                role="radio"
                aria-checked={p.barrier === d}
                onClick={() => p.setBarrier(d)}
                className={`num rounded-md border py-1.5 text-sm transition-colors ${
                  p.barrier === d ? "border-scope bg-scope/20 text-phosphor" : "border-line text-mute hover:text-text"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      )}
      {p.contract === "matches_differs" && (
        <p className="-mt-2 text-xs text-mute">The engine selects the digit, either the most likely (Matches) or the least likely (Differs).</p>
      )}

      {/* Duration */}
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <span className="label">Duration</span>
          <span className="num text-xs text-mute">
            {p.duration} tick{p.duration > 1 ? "s" : ""}
          </span>
        </div>
        <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label="Duration in ticks">
          {DURATIONS.map((d) => (
            <button
              key={d}
              role="radio"
              aria-checked={p.duration === d}
              onClick={() => p.setDuration(d)}
              className={`num rounded-[10px] border py-2.5 text-base transition-all ${
                p.duration === d ? "border-scope bg-scope/15 text-phosphor" : "border-line text-mute hover:border-line-2 hover:text-text"
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      <button onClick={p.onExecute} disabled={p.busy || !p.feedReady} className="btn-primary mt-auto py-3.5 text-sm">
        {p.busy ? "Analysing…" : p.feedReady ? "Execute analysis" : "Waiting for feed…"}
      </button>
      <p className="-mt-3 text-center text-[0.7rem] text-mute">Analysis only. This app never places trades.</p>
    </section>
  );
}
