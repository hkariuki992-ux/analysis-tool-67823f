import { useEffect, useRef, useState } from "react";
import type { DerivStatus } from "../auth/useDeriv";

type Props = {
  status: DerivStatus;
  onConnect: () => void;
  onDisconnect: () => Promise<void>;
};

function fmtBalance(n: number, ccy: string) {
  return `${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ccy}`;
}

function DerivMark() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden>
      <path d="M4 3h7a6 6 0 0 1 0 12H8l-2 3H4V3Zm4 3v6h3a3 3 0 0 0 0-6H8Z" fill="currentColor" />
    </svg>
  );
}

export function DerivConnect({ status, onConnect, onDisconnect }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (status.state === "loading") {
    return <div className="h-10 w-44 animate-pulse rounded-[10px] bg-panel-2" aria-label="Checking Deriv connection" />;
  }

  if (status.state === "connected") {
    const primary = status.accounts?.[0];
    const expires = status.expiresAt ? new Date(status.expiresAt) : null;
    return (
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen((o) => !o)}
          className="btn-ghost flex h-10 items-center gap-2.5 px-3"
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          <span className="h-2 w-2 rounded-full bg-hit pulse-dot" />
          <span className="text-left leading-tight">
            <span className="block font-display text-[0.7rem] tracking-[0.14em] text-mute uppercase">Deriv connected</span>
            <span className="num block text-sm">
              {primary ? `${primary.accountId} · ${fmtBalance(primary.balance, primary.currency)}` : "Account linked"}
            </span>
          </span>
        </button>
        {open && (
          <div
            role="dialog"
            aria-label="Deriv account"
            className="panel absolute right-0 z-40 mt-2 w-[22rem] p-4 rise-in"
          >
            <p className="label mb-3">Linked accounts</p>
            {status.accountsError === "insufficient_scope" && (
              <p className="mb-3 rounded-lg border border-amber/40 bg-amber/10 p-2 text-xs text-amber">
                Deriv says this token is missing the <code>trade</code> scope needed to list accounts. Reconnect and approve it.
              </p>
            )}
            <ul className="space-y-2">
              {(status.accounts ?? []).map((a) => (
                <li key={a.accountId} className="flex items-center justify-between rounded-lg border border-line bg-ink-2/60 px-3 py-2">
                  <span>
                    <span className="num block text-sm">{a.accountId}</span>
                    <span className="text-xs text-mute">
                      {a.group.toUpperCase()} · {a.status}
                    </span>
                  </span>
                  <span className="text-right">
                    <span
                      className={`mb-0.5 inline-block rounded px-1.5 py-0.5 font-display text-[0.62rem] tracking-[0.14em] uppercase ${
                        a.accountType === "real" ? "bg-amber/15 text-amber" : "bg-scope/15 text-scope"
                      }`}
                    >
                      {a.accountType}
                    </span>
                    <span className="num block text-sm">{fmtBalance(a.balance, a.currency)}</span>
                  </span>
                </li>
              ))}
              {(status.accounts ?? []).length === 0 && (
                <li className="text-sm text-mute">No Options accounts returned by Deriv yet.</li>
              )}
            </ul>
            <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
              <dt className="text-mute">Access granted</dt>
              <dd className="num text-right">{status.scopes.join(", ")} (read-only use)</dd>
              <dt className="text-mute">Token expires</dt>
              <dd className="num text-right">{expires ? expires.toLocaleString() : "—"}</dd>
              <dt className="text-mute">Trading</dt>
              <dd className="text-right text-hit">Disabled in this app</dd>
            </dl>
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await onDisconnect();
                setBusy(false);
                setOpen(false);
              }}
              className="btn-ghost mt-4 w-full py-2 text-sm text-miss hover:border-miss/60"
            >
              {busy ? "Disconnecting…" : "Disconnect Deriv"}
            </button>
          </div>
        )}
      </div>
    );
  }

  const expired = status.state === "expired";
  const notConfigured = status.state === "not_configured";
  const offline = status.state === "offline";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => (notConfigured || offline ? setOpen((o) => !o) : onConnect())}
        className={`btn-primary flex h-10 items-center gap-2 px-4 text-sm ${expired ? "is-warn" : ""}`}
        title={notConfigured ? "Add DERIV_APP_ID to enable Deriv login" : undefined}
      >
        <DerivMark />
        {expired ? "Reconnect Deriv" : "Connect Deriv"}
      </button>
      {expired && (
        <p className="absolute right-0 mt-1 text-[0.7rem] whitespace-nowrap text-amber">Session expired. Deriv issues no refresh tokens.</p>
      )}
      {open && (notConfigured || offline) && (
        <div role="dialog" aria-label="Deriv setup" className="panel absolute right-0 z-40 mt-2 w-[24rem] p-4 text-sm rise-in">
          {offline ? (
            <>
              <p className="label mb-2">Backend unreachable</p>
              <p className="text-mute">
                The Deriv OAuth functions aren't responding. Run the project with <code className="num">netlify dev</code> or
                open the deployed site.
              </p>
            </>
          ) : (
            <>
              <p className="label mb-2">Deriv OAuth setup</p>
              <p className="mb-3 text-mute">Register this exact redirect URL on your Deriv OAuth app, then set the App ID:</p>
              <code className="num block rounded-lg border border-line bg-ink-2 p-2 text-xs break-all text-phosphor">
                {status.redirectUri}
              </code>
              <ul className="mt-3 space-y-1 text-xs text-mute">
                <li>
                  Scope: <span className="num text-text">{status.scopes.join(" ")}</span>
                </li>
                <li>
                  Missing env: <span className="num text-amber">{status.missing.join(", ")}</span>
                </li>
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
