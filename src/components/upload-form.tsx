"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type UploadResult = {
  status: "parsed" | "failed" | "duplicate_file";
  inserted: number;
  duplicates: number;
  warnings: string[];
  periodStart?: string | null;
  periodEnd?: string | null;
  classification?: {
    byRule: number;
    byLlm: number;
    unclassified: number;
    lowConfidence: number;
  };
};

export function UploadForm({
  accounts,
  hasLlm,
}: {
  accounts: Array<{ id: string; name: string }>;
  hasLlm: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Array<{ name: string; result: UploadResult }>>([]);
  const [accountId, setAccountId] = useState("");

  async function upload(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;

    setBusy(true);
    setError(null);

    // Sequential, not parallel: each import dedupes against what's already in
    // the ledger, and two overlapping statements racing would each miss the
    // other's rows.
    for (const file of list) {
      const body = new FormData();
      body.set("file", file);
      if (accountId) body.set("accountId", accountId);

      try {
        const res = await fetch("/api/upload", { method: "POST", body });
        const json = await res.json();
        if (!res.ok) {
          setError(json.error ?? "That import failed.");
          continue;
        }
        setResults((prev) => [...prev, { name: file.name, result: json }]);
      } catch {
        setError("Could not reach the server. Check your connection and retry.");
      }
    }

    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {accounts.length > 0 ? (
        <div>
          <label htmlFor="account" className="mb-1.5 block text-sm font-medium">
            Account
          </label>
          <select
            id="account"
            className="field"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            <option value="">
              {accounts.length > 1
                ? "Choose an account…"
                : "Detect from the statement"}
            </option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          {accounts.length > 1 && !accountId ? (
            <p className="mt-1.5 text-xs text-[var(--color-ink-muted)]">
              A CSV can&rsquo;t say which account it came from. Filing it here
              keeps an identical charge on another account from being read as a
              duplicate.
            </p>
          ) : null}
        </div>
      ) : null}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void upload(e.dataTransfer.files);
        }}
        className={`card flex flex-col items-center justify-center px-6 py-12 text-center transition-colors ${
          dragging ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]" : ""
        }`}
      >
        <p className="display text-xl">Drop statements here</p>
        <p className="mt-1.5 max-w-sm text-sm text-[var(--color-ink-muted)]">
          {hasLlm
            ? "CSV exports, PDF statements, or screenshots. Upload as many as you like — overlapping periods are deduplicated."
            : "CSV exports. Add a Claude API key to also read PDFs and screenshots."}
        </p>

        <input
          ref={inputRef}
          type="file"
          multiple
          accept={hasLlm ? ".csv,.tsv,.txt,.pdf,image/*" : ".csv,.tsv,.txt"}
          className="sr-only"
          id="statement-file"
          onChange={(e) => e.target.files && void upload(e.target.files)}
        />
        <label htmlFor="statement-file" className="btn btn-primary mt-5">
          {busy ? "Importing…" : "Choose files"}
        </label>
      </div>

      {busy ? (
        <p className="text-sm text-[var(--color-ink-muted)]" role="status">
          Reading the statement and categorizing transactions. A long PDF can
          take a minute.
        </p>
      ) : null}

      {error ? (
        <div className="card border-[var(--color-negative)] bg-[var(--color-negative-soft)] p-4">
          <p className="text-sm">{error}</p>
        </div>
      ) : null}

      {results.map((r, i) => (
        <div key={i} className="card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-medium">{r.name}</p>
            <span className="chip">
              {r.result.status === "duplicate_file"
                ? "Already imported"
                : `${r.result.inserted} added`}
            </span>
          </div>

          {r.result.classification ? (
            <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
              {r.result.classification.byRule} matched a rule,{" "}
              {r.result.classification.byLlm} categorized by Claude
              {r.result.classification.lowConfidence > 0
                ? `, ${r.result.classification.lowConfidence} worth a look`
                : ""}
              {r.result.classification.unclassified > 0
                ? `, ${r.result.classification.unclassified} left uncategorized`
                : ""}
              .
            </p>
          ) : null}

          {r.result.warnings.length > 0 ? (
            <ul className="mt-2 space-y-1 text-sm text-[var(--color-ink-muted)]">
              {r.result.warnings.map((w, j) => (
                <li key={j}>• {w}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
    </div>
  );
}
