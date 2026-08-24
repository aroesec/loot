import type { ParseResult } from "@/lib/parse/types";

/**
 * Where transactions come from.
 *
 * Everything downstream of this file — dedupe, reconciliation, classification,
 * the ledger — only ever sees `ParsedTransaction[]`. That is the whole point:
 * adding a bank, an aggregator or a one-off CSV dialect should mean writing an
 * adapter here and nothing else. Nothing below this boundary is allowed to know
 * whether a row arrived by upload or by sync.
 *
 * There are two shapes, because pulling and parsing are genuinely different:
 *
 *   `FileSource`  — bytes in, transactions out. Stateless, and re-running it on
 *                   the same file is expected to be a no-op thanks to dedupe.
 *                   CSV, PDF and image imports are these.
 *
 *   `SyncSource`  — an incremental pull against a stored cursor. Stateful, and
 *                   it owns its own idea of "what is new". Plaid is one.
 *
 * A source is not asked to dedupe, classify, or apply the sign convention on
 * anything other than its own output. It is asked to produce transactions where
 * **negative means money left the account**, which is the one invariant an
 * adapter can get wrong in a way nothing downstream can detect.
 */

export type SourceKind = "csv" | "pdf" | "image";

export type FileSource = {
  id: string;
  /** Shown when the import fails and a human has to work out why. */
  label: string;
  /** Whether this adapter wants a given upload. First match wins. */
  accepts(input: { mimeType: string; filename: string }): boolean;
  parse(input: {
    bytes: Uint8Array;
    filename: string;
    mimeType: string;
    /**
     * The account the upload was filed against, when known. Adapters use it
     * for sign convention: a credit card export commonly writes charges as
     * positive numbers, a checking export does not.
     */
    accountKind?: string | null;
  }): Promise<ParseResult> | ParseResult;
};

export type SyncOutcome = {
  added: number;
  updated: number;
  removed: number;
  /** Skipped because a statement import already covers that date. */
  alreadyCovered: number;
  duplicates: number;
  error?: string;
};

export type SyncSource = {
  id: string;
  label: string;
  /** False when the deployment has not configured this source. */
  isConfigured(): boolean;
  /** Pull everything new for one connection. */
  sync(connectionId: string): Promise<SyncOutcome>;
};

const fileSources: FileSource[] = [];
const syncSources: SyncSource[] = [];

export function registerFileSource(source: FileSource): void {
  fileSources.push(source);
}

export function registerSyncSource(source: SyncSource): void {
  syncSources.push(source);
}

/**
 * First registered adapter that accepts the upload. Registration order is
 * therefore priority order: a bank-specific adapter registered before the
 * generic CSV one will claim its own exports.
 */
export function resolveFileSource(input: {
  mimeType: string;
  filename: string;
}): FileSource | null {
  return fileSources.find((s) => s.accepts(input)) ?? null;
}

export function listFileSources(): readonly FileSource[] {
  return fileSources;
}

export function listSyncSources(): readonly SyncSource[] {
  return syncSources.filter((s) => s.isConfigured());
}
