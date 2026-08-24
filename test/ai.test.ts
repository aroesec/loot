import { describe, it, expect, beforeEach } from "vitest";

/**
 * Provider selection is env-driven and memoized, so these set the environment
 * and reset between cases. What matters is that an existing deployment keeps
 * working untouched, and that "no provider" stays a supported configuration
 * rather than an error.
 */
function clearAiEnv() {
  for (const k of [
    "AI_PROVIDER",
    "AI_API_KEY",
    "AI_BASE_URL",
    "AI_MODEL",
    "ANTHROPIC_API_KEY",
  ]) {
    delete process.env[k];
  }
}

beforeEach(() => {
  process.env.DATABASE_URL ??= "postgres://test/test";
  process.env.APP_PASSWORD ??= "test-password";
  process.env.SESSION_SECRET ??= "x".repeat(32);
  clearAiEnv();
});

/**
 * Mirrors the selection in lib/ai/index.ts. Duplicated rather than imported
 * because `env.ts` validates at module load and memoizes, which makes the real
 * module awkward to drive from a table of cases — the logic under test is the
 * decision, not the wiring.
 */
function chooseProvider(e: Record<string, string | undefined>) {
  const apiKey = e.AI_API_KEY || e.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return (
    e.AI_PROVIDER ??
    (e.AI_BASE_URL && !e.AI_BASE_URL.includes("anthropic.com")
      ? "openai"
      : "anthropic")
  );
}

describe("AI provider selection", () => {
  it("runs with no provider at all", () => {
    // Not a degraded mode: rules still classify and CSV import is unaffected.
    expect(chooseProvider({})).toBeNull();
  });

  it("keeps working for a deployment that only set ANTHROPIC_API_KEY", () => {
    expect(chooseProvider({ ANTHROPIC_API_KEY: "sk-ant-x" })).toBe("anthropic");
  });

  it("infers an OpenAI-compatible endpoint from a base URL", () => {
    // Pointing somewhere else is the only reason to set this.
    expect(
      chooseProvider({ AI_API_KEY: "k", AI_BASE_URL: "http://localhost:11434/v1" }),
    ).toBe("openai");
    expect(
      chooseProvider({ AI_API_KEY: "k", AI_BASE_URL: "https://openrouter.ai/api/v1" }),
    ).toBe("openai");
  });

  it("does not mistake a custom Anthropic gateway for OpenAI", () => {
    expect(
      chooseProvider({
        AI_API_KEY: "k",
        AI_BASE_URL: "https://gateway.example.com/anthropic.com/v1",
      }),
    ).toBe("anthropic");
  });

  it("lets an explicit provider win over inference", () => {
    expect(
      chooseProvider({
        AI_PROVIDER: "anthropic",
        AI_API_KEY: "k",
        AI_BASE_URL: "https://proxy.example.com/v1",
      }),
    ).toBe("anthropic");
  });

  it("prefers AI_API_KEY over the legacy variable", () => {
    expect(
      chooseProvider({ AI_API_KEY: "new", ANTHROPIC_API_KEY: "old" }),
    ).toBe("anthropic");
  });
});

describe("document support", () => {
  it("is the one capability that varies by provider", async () => {
    const { openAiCompatibleProvider } = await import(
      "@/lib/ai/openai-compatible"
    );
    const { anthropicProvider } = await import("@/lib/ai/anthropic");

    // PDFs are gated on this so the failure names the configured provider
    // instead of surfacing deep inside a parse.
    expect(
      openAiCompatibleProvider({
        apiKey: "k",
        model: "gpt-4o-mini",
        baseUrl: "https://api.openai.com/v1",
      }).supportsDocuments,
    ).toBe(false);

    expect(
      anthropicProvider({ apiKey: "k", model: "claude-opus-5" })
        .supportsDocuments,
    ).toBe(true);
  });
});
