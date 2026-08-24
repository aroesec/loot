import { env } from "@/lib/env";
import { anthropicProvider } from "./anthropic";
import { openAiCompatibleProvider } from "./openai-compatible";
import { AiUnavailableError, type AiProvider } from "./types";

export * from "./types";

let cached: AiProvider | null = null;
let resolved = false;

/**
 * The configured provider, or null when the deployment has no AI at all.
 *
 * Resolution prefers the explicit `AI_*` variables and falls back to
 * `ANTHROPIC_API_KEY`, so an existing deployment keeps working untouched. The
 * provider is inferred from what is set rather than demanded up front: an
 * `AI_BASE_URL` means an OpenAI-compatible endpoint, because that is the only
 * reason to point somewhere else.
 */
export function aiProvider(): AiProvider | null {
  if (resolved) return cached;
  resolved = true;

  const apiKey = env.AI_API_KEY || env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    cached = null;
    return cached;
  }

  const explicit = env.AI_PROVIDER;
  const kind =
    explicit ??
    (env.AI_BASE_URL && !env.AI_BASE_URL.includes("anthropic.com")
      ? "openai"
      : "anthropic");

  if (kind === "openai") {
    cached = openAiCompatibleProvider({
      apiKey,
      model: env.AI_MODEL || "gpt-4o-mini",
      baseUrl: env.AI_BASE_URL || "https://api.openai.com/v1",
    });
  } else {
    cached = anthropicProvider({
      apiKey,
      model: env.AI_MODEL || env.LLM_MODEL,
      baseUrl: env.AI_BASE_URL ?? null,
    });
  }

  return cached;
}

/** True when model-backed features are available. */
export const hasAi = (): boolean => aiProvider() !== null;

export function requireAi(): AiProvider {
  const provider = aiProvider();
  if (!provider) throw new AiUnavailableError();
  return provider;
}

/**
 * A provider that can read a PDF. Separate from `requireAi` because document
 * support is the one capability that genuinely varies, and the caller needs to
 * say which provider is configured when it is missing.
 */
export function requireDocumentAi(): AiProvider {
  const provider = requireAi();
  if (!provider.supportsDocuments) {
    throw new AiUnavailableError(
      `The configured provider (${provider.id}, ${provider.model}) cannot read PDFs.`,
    );
  }
  return provider;
}

/** Test seam: forget the memoized provider after changing env. */
export function resetAiProvider(): void {
  cached = null;
  resolved = false;
}
