import { useEffect, useState } from "react";
import { consumeOAuthResult, useDeriv } from "./auth/useDeriv";
import { ControlDeck } from "./components/ControlDeck";
import { DerivConnect } from "./components/DerivConnect";
import { NeuralEngine, type ActivePrediction } from "./components/NeuralEngine";
import { Ticker } from "./components/Ticker";
import { analyze, type AnalysisResult, type ContractFamily, type Duration } from "./engine/analysis";
import { useFeed } from "./feed/useFeed";

export default function App() {
  const feed = useFeed();
  const deriv = useDeriv();
  const [notice, setNotice] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [symbol, setSymbol] = useState("R_100");
  const [contract, setContract] = useState<ContractFamily>("even_odd");
  const [barrier, setBarrier] = useState(5);
  const [duration, setDuration] = useState<Duration>(1);
  const [autoSelect, setAutoSelect] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [prediction, setPrediction] = useState<ActivePrediction | null>(null);

  useEffect(() => setNotice(consumeOAuthResult()), []);

  const execute = async () => {
    setBusy(true);
    try {
      const buf = feed.get(symbol);
      if (!buf.historyLoaded) await feed.loadHistory(symbol);
      const r = analyze({ symbol, digits: buf.digits, quotes: buf.quotes, contract, duration, barrier });
      setResult(r);
      const now = Date.now();
      setPrediction({ id: String(now), createdAt: now, expiresAt: now + 10_000, result: r });
    } catch (e) {
      setNotice({ kind: "error", message: e instanceof Error ? e.message : "Analysis failed" });
    } finally {
      setBusy(false);
    }
  };

  const buf = feed.get(symbol);
  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="label">Blue Scope</p>
          <h1 className="font-display text-2xl tracking-wide">
            Analysis Tool <span className="text-scope">v2.4</span>
          </h1>
        </div>
        <DerivConnect status={deriv.status} onConnect={deriv.connect} onDisconnect={deriv.disconnect} />
      </header>
      {notice && (
        <p className={`rounded-lg border px-3 py-2 text-sm ${notice.kind === "error" ? "border-miss/40 text-miss" : "border-hit/40 text-hit"}`}>
          {notice.message}
        </p>
      )}
      <Ticker selected={symbol} onSelect={setSymbol} />
      <div className="grid gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <ControlDeck
          symbol={symbol}
          setSymbol={setSymbol}
          contract={contract}
          setContract={setContract}
          barrier={barrier}
          setBarrier={setBarrier}
          duration={duration}
          setDuration={setDuration}
          autoSelect={autoSelect}
          setAutoSelect={setAutoSelect}
          onExecute={execute}
          busy={busy}
          feedReady={feed.status === "open"}
        />
        <NeuralEngine
          result={result}
          prediction={prediction}
          liveDigit={buf.digits.at(-1) ?? null}
          loadingLabel={busy ? "Collecting up to 10,000 ticks…" : null}
        />
      </div>
    </div>
  );
}
