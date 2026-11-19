type Props = {
  distribution: number[] | null;
  frequency: number[] | null;
  highlight: number | null;
  /** last digit of the latest tick, pulses on the radar */
  liveDigit: number | null;
};

const SIZE = 300;
const C = SIZE / 2;
const R = 118;

const SWEEP_ANGLE = (40 * Math.PI) / 180;
const SWEEP_PATH = `M${C},${C} L${C + R},${C} A${R},${R} 0 0,0 ${(C + Math.cos(-SWEEP_ANGLE) * R).toFixed(1)},${(
  C + Math.sin(-SWEEP_ANGLE) * R
).toFixed(1)} Z`;

function polar(i: number, r: number) {
  const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
  return [C + Math.cos(a) * r, C + Math.sin(a) * r] as const;
}

/** ML DIGIT RADAR — ensemble probability per digit vs. the 10% fair line. */
export function DigitRadar({ distribution, frequency, highlight, liveDigit }: Props) {
  // Radial domain starts at 5% so deviations around the 10% fair line are readable.
  const FLOOR = 0.05;
  const max = Math.max(0.15, ...(distribution ?? []), ...(frequency ?? []));
  const scale = (p: number) => R * (0.15 + (0.85 * (Math.max(FLOOR, p) - FLOOR)) / (max - FLOOR));
  const path = (v: number[]) =>
    v.map((p, i) => polar(i, scale(p))).map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("") + "Z";

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-auto w-full max-w-[22rem]" role="img" aria-label="Digit probability radar">
      <defs>
        <radialGradient id="radar-bg" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#5cb8e6" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#5cb8e6" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#a8e4fb" stopOpacity="0" />
          <stop offset="100%" stopColor="#a8e4fb" stopOpacity="0.28" />
        </linearGradient>
      </defs>
      <circle cx={C} cy={C} r={R + 8} fill="url(#radar-bg)" />
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <circle key={f} cx={C} cy={C} r={R * f} fill="none" stroke="#1b2942" strokeDasharray={f === 1 ? undefined : "2 4"} />
      ))}
      {Array.from({ length: 10 }, (_, i) => {
        const [x, y] = polar(i, R);
        return <line key={i} x1={C} y1={C} x2={x} y2={y} stroke="#1b2942" />;
      })}
      {/* fair 10% line */}
      <circle cx={C} cy={C} r={scale(0.1)} fill="none" stroke="#7c8aa6" strokeOpacity="0.7" strokeDasharray="3 3" />

      {/* hydro sweep */}
      <g className="radar-sweep">
        <path d={SWEEP_PATH} fill="url(#sweep)" opacity="0.7" />
      </g>

      {frequency && <path d={path(frequency)} fill="none" stroke="#2f6d94" strokeWidth="1.2" />}
      {distribution && (
        <path d={path(distribution)} fill="rgba(92,184,230,0.16)" stroke="#5cb8e6" strokeWidth="1.8" strokeLinejoin="round" />
      )}
      {distribution?.map((p, i) => {
        const [x, y] = polar(i, scale(p));
        return <circle key={i} cx={x} cy={y} r={i === highlight ? 5 : 2.6} fill={i === highlight ? "#a8e4fb" : "#5cb8e6"} />;
      })}

      {Array.from({ length: 10 }, (_, i) => {
        const [x, y] = polar(i, R + 20);
        const isLive = i === liveDigit;
        return (
          <g key={i}>
            {isLive && <circle cx={x} cy={y} r="11" fill="#5cb8e6" opacity="0.22" />}
            <text
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="central"
              className="num"
              fontSize="13"
              fontWeight={i === highlight ? 700 : 500}
              fill={i === highlight ? "#a8e4fb" : isLive ? "#dde6f4" : "#7c8aa6"}
            >
              {i}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
