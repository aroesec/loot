/**
 * The model interface the rest of the app codes against.
 *
 * Three things need a model here — categorizing transactions, reading a PDF or
 * photographed statement, and writing up insights — and all three want the same
 * two capabilities: a completion, and a way to force structured output. Keeping
 * the surface that small is what makes the provider swappable, and it is why
 * nothing outside `src/lib/ai` imports a vendor SDK.
 *
 * Running with no provider at all is a supported configuration, not a
 * degraded one. Classification falls back to rules, unmatched rows land in the
 * review queue, and CSV import is unaffected.
 */

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
};

export type AiContent =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: string; dataBase64: string }
  /** A PDF. Far fewer providers accept these than accept images. */
  | { type: "document"; mediaType: string; dataBase64: string };

export type AiMessage = {
  role: "user" | "assistant";
  content: AiContent[];
};

export type CompletionRequest = {
  system: string;
  messages: AiMessage[];
  maxTokens: number;
  /**
   * Forces the reply to match a JSON Schema. Both supported providers enforce
   * this server-side, which is what lets callers parse without a repair step.
   *
   * The schema must set `additionalProperties: false` and list every property
   * in `required` — OpenAI's strict mode rejects anything looser, and
   * Anthropic is happy with it either way.
   */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  /**
   * Hint that the system prompt is identical across a batch and worth caching.
   * Honoured where the provider supports it, ignored where it does not — this
   * is a cost optimization, never a correctness requirement.
   */
  cacheSystem?: boolean;
  /** Reasoning effort, where the provider exposes it. */
  effort?: "low" | "medium" | "high";
};

export type CompletionResult = {
  text: string;
  usage: Usage;
  /** Set when the model declined. Callers surface this rather than retrying. */
  refused?: boolean;
};

export type AiProvider = {
  id: string;
  model: string;
  /**
   * Whether the provider accepts PDFs. Most OpenAI-compatible endpoints do
   * not, so statement-by-PDF is gated on this rather than assumed — and the
   * error says which provider is configured instead of failing obscurely.
   */
  supportsDocuments: boolean;
  complete(request: CompletionRequest): Promise<CompletionResult>;
};

export class AiUnavailableError extends Error {
  constructor(detail = "No AI provider is configured.") {
    super(
      `${detail} Set AI_API_KEY (and AI_PROVIDER if not using Anthropic) to enable model-backed features. Rules-based classification and CSV import work without it.`,
    );
    this.name = "AiUnavailableError";
  }
}
