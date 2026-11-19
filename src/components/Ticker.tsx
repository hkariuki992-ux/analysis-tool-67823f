import { useEffect, useRef } from "react";
import { feed } from "../feed/feed";
import { ASSETS } from "../feed/symbols";

type Props = { selected: string; onSelect: (symbol: string) => void };

/** LIVE SPOT TICKER — every tick from the 12 streams, last digit highlighted. */
export function Ticker({ selected, onSelect }: Props) {
  return (
    <div className="panel overflow-hidden">
      <div className="flex items-stretch">
        <div className="hidden shrink-0 flex-col justify-center border-r border-line px-4 sm:flex">
          <span className="label">Live spot</span>
          <span className="num text-xs text-scope">{feed.ticksPerSec.toFixed(1)} t/s</span>
        </div>
        <ul className="flex flex-1 gap-px overflow-x-auto [scrollbar-width:thin]">
          {ASSETS.map((a) => (
            <TickerCell key={a.symbol} symbol={a.symbol} short={a.short} active={selected === a.symbol} onSelect={onSelect} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function TickerCell({
  symbol,
  short,
  active,
  onSelect,
}: {
  symbol: string;
  short: string;
  active: boolean;
  onSelect: (s: string) => void;
}) {
  const buf = feed.get(symbol);
  const ref = useRef<HTMLButtonElement>(null);
  const lastEpoch = useRef<number | null>(null);

  useEffect(() => {
    if (buf.lastEpoch !== lastEpoch.current && ref.current) {
      lastEpoch.current = buf.lastEpoch;
      ref.current.classList.remove("tick-flash");
      void ref.current.offsetWidth;
      ref.current.classList.add("tick-flash");
    }
  });

  const q = buf.lastQuote;
  const up = q !== null && buf.prevQuote !== null ? q > buf.prevQuote : null;
  const str = q !== null ? q.toFixed(buf.decimals) : null;

  return (
    <li className="min-w-[8.5rem] flex-1">
      <button
        ref={ref}
        onClick={() => onSelect(symbol)}
        className={`flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left transition-colors ${
          active ? "bg-scope/10 shadow-[inset_0_-2px_0_var(--color-scope)]" : "hover:bg-panel-2"
        }`}
        aria-pressed={active}
      >
        <span className="flex w-full items-center justify-between">
          <span className="font-display text-[0.72rem] tracking-[0.12em] text-mute">{short}</span>
          {up !== null && (
            <span className={`text-[0.65rem] ${up ? "text-hit" : "text-miss"}`} aria-label={up ? "up" : "down"}>
              {up ? "▲" : "▼"}
            </span>
          )}
        </span>
        {str ? (
          <span className="num text-[0.95rem] leading-tight">
            {str.slice(0, -1)}
            <span className="rounded-sm bg-scope/20 px-0.5 font-bold text-phosphor">{str.slice(-1)}</span>
          </span>
        ) : (
          <span className="h-4 w-20 animate-pulse rounded bg-panel-2" />
        )}
      </button>
    </li>
  );
}
