"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlaidLink } from "react-plaid-link";

type LinkedItem = {
  id: string;
  institutionName: string | null;
  status: string;
  errorCode: string | null;
  lastSyncedAt: string | null;
  accountCount: number;
};

type SyncReport = {
  institution: string;
  added: number;
  updated: number;
  removed: number;
  alreadyCovered: number;
  duplicates: number;
  refreshed?: boolean;
  error?: string;
};

/**
 * Plaid Link is a hosted flow: credentials are entered inside Plaid's own
 * iframe and this app never sees them. What comes back is a one-time public
 * token, which the server trades for a long-lived access token — so nothing
 * durable is handled in the browser either.
 */
export function PlaidLinkButton({
  configured,
  items,
  environment,
}: {
  configured: boolean;
  items: LinkedItem[];
  environment: string;
}) {
  const router = useRouter();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);

  const requestLinkToken = useCallback(async (itemId?: string) => {
    setError(null);
    setMessage(null);
    setBusy(itemId ?? "new");
    try {
      const res = await fetch("/api/plaid/link-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(itemId ? { itemId } : {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not start the link flow.");
      setPendingItemId(itemId ?? null);
      setLinkToken(data.linkToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, []);

  const onSuccess = useCallback(
    // Nullable because update mode returns no public token — there is no new
    // Item to exchange, only an existing one that has been repaired.
    async (publicToken: string | null) => {
      setBusy("exchange");
      setLinkToken(null);
      try {
        /*
         * Update mode repairs an existing Item, so there is no new public
         * token to exchange — just sync it and let the error state clear.
         */
        const endpoint = pendingItemId ? "/api/plaid/sync" : "/api/plaid/exchange";
        if (!pendingItemId && !publicToken) {
          throw new Error("Plaid returned no public token.");
        }
        const body = pendingItemId
          ? // Update mode may have widened the history window, which only
            // arrives on a full pull.
            { itemId: pendingItemId, fullHistory: true }
          : { publicToken };

        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not finish linking.");

        const sync: SyncReport | undefined = data.sync ?? data.reports?.[0];
        setMessage(
          sync
            ? `${data.institution ?? sync.institution}: ${sync.added} transaction${sync.added === 1 ? "" : "s"} added` +
                (sync.alreadyCovered > 0
                  ? `, ${sync.alreadyCovered} skipped as already imported`
                  : "")
            : "Linked.",
        );
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
        setPendingItemId(null);
      }
    },
    [pendingItemId, router],
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit: () => {
      setLinkToken(null);
      setPendingItemId(null);
    },
  });

  // Link has to be opened from an effect: the token arrives after the click
  // that asked for it, so there is no user gesture left to open it inside.
  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  async function syncAll() {
    setBusy("sync");
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/plaid/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sync failed.");

      const reports: SyncReport[] = data.reports ?? [];
      const failed = reports.filter((r) => r.error);
      const added = reports.reduce((a, r) => a + r.added, 0);
      const updated = reports.reduce((a, r) => a + r.updated, 0);

      setMessage(
        `${added} added, ${updated} updated across ${reports.length} bank${reports.length === 1 ? "" : "s"}.`,
      );
      if (failed.length > 0) {
        setError(failed.map((f) => `${f.institution}: ${f.error}`).join(" · "));
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  if (!configured) {
    return (
      <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
        Set <code>PLAID_CLIENT_ID</code>, <code>PLAID_SECRET</code> and{" "}
        <code>PLAID_TOKEN_KEY</code> to turn this on. Until then, statement
        upload is unaffected.
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-3">
      {environment !== "production" ? (
        <p className="text-xs text-[var(--color-ink-muted)]">
          Connected to Plaid <strong>{environment}</strong>. Test credentials
          only — no real bank data, and no Items counted against the free tier.
        </p>
      ) : null}

      {items.length > 0 ? (
        <ul className="divide-y divide-[var(--color-border)]">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
            >
              <span>
                {item.institutionName ?? "Bank"}
                <span className="ml-2 text-xs text-[var(--color-ink-muted)]">
                  {item.accountCount} account{item.accountCount === 1 ? "" : "s"}
                  {item.lastSyncedAt
                    ? ` · synced ${new Date(item.lastSyncedAt).toLocaleDateString()}`
                    : " · never synced"}
                </span>
              </span>
              {item.status === "needs_reauth" ? (
                <button
                  type="button"
                  className="btn !py-1"
                  disabled={busy !== null}
                  onClick={() => requestLinkToken(item.id)}
                >
                  Reconnect
                </button>
              ) : (
                <span className="flex items-center gap-2">
                  <span className="chip">connected</span>
                  {/*
                    Update mode is also the only way to widen an Item's history
                    window. A connection created under Plaid's 90-day default
                    stays at 90 days however many times it syncs, so this has to
                    be reachable while the connection is perfectly healthy.
                  */}
                  <button
                    type="button"
                    className="btn !py-1"
                    disabled={busy !== null}
                    onClick={() => requestLinkToken(item.id)}
                    title="Ask the bank for up to two years of history instead of the default 90 days"
                  >
                    {busy === item.id ? "Opening…" : "Extend history"}
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy !== null}
          onClick={() => requestLinkToken()}
        >
          {busy === "new" ? "Opening…" : "Connect a bank"}
        </button>
        {items.length > 0 ? (
          <button
            type="button"
            className="btn"
            disabled={busy !== null}
            onClick={syncAll}
          >
            {busy === "sync" ? "Syncing…" : "Sync now"}
          </button>
        ) : null}
      </div>

      {message ? (
        <p className="text-sm text-[var(--color-positive)]">{message}</p>
      ) : null}
      {error ? (
        <p className="text-sm text-[var(--color-negative)]">{error}</p>
      ) : null}
    </div>
  );
}
