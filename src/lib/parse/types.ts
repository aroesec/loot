export type ParsedTransaction = {
  /** ISO yyyy-mm-dd */
  postedOn: string;
  /** Negative = money out. */
  amountCents: number;
  rawDescription: string;
  currency?: string | undefined;
};

export type ParseResult = {
  transactions: ParsedTransaction[];
  warnings: string[];
  /** Statement period, when the source states it. */
  periodStart?: string | null;
  periodEnd?: string | null;
  /** Institution / account hints the parser recovered from the document. */
  accountHint?: {
    institution?: string | null;
    last4?: string | null;
    kind?: string | null;
  } | null;
  usage?: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    ms: number;
  } | null;
};

export function detectSourceKind(
  mimeType: string,
  filename: string,
): "csv" | "pdf" | "image" | null {
  const name = filename.toLowerCase();
  if (mimeType === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (mimeType.startsWith("image/")) return "image";
  if (
    mimeType.includes("csv") ||
    mimeType === "text/plain" ||
    mimeType === "application/vnd.ms-excel" ||
    name.endsWith(".csv") ||
    name.endsWith(".tsv") ||
    name.endsWith(".txt") ||
    name.endsWith(".qfx") ||
    name.endsWith(".ofx")
  ) {
    return "csv";
  }
  return null;
}
