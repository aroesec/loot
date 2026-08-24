import type {
  AiContent,
  AiProvider,
  CompletionRequest,
  CompletionResult,
} from "./types";

/**
 * Anything speaking OpenAI's `/v1/chat/completions`.
 *
 * That is a large family — OpenAI itself, OpenRouter, Groq, Together, Fireworks,
 * and local runtimes like Ollama, LM Studio and vLLM — so one adapter covers
 * both "I want GPT" and "I want nothing leaving my network". Called over plain
 * `fetch` rather than the OpenAI SDK, because the request shape is stable and a
 * dependency is a poor trade for it.
 *
 * Two things genuinely differ from Anthropic and are handled here rather than
 * pushed onto callers:
 *
 *   Structured output uses `response_format`, and strict mode requires the
 *   schema to forbid extra properties and mark every property required. The
 *   app's schemas already do; a stricter failure here is better than a silently
 *   unstructured reply.
 *
 *   PDFs are not accepted. Most endpoints in this family take images but not
 *   documents, so `supportsDocuments` is false and PDF import says so plainly
 *   instead of failing deep inside a parse.
 */
export function openAiCompatibleProvider(config: {
  apiKey: string;
  model: string;
  baseUrl: string;
}): AiProvider {
  const base = config.baseUrl.replace(/\/+$/, "");

  return {
    id: "openai-compatible",
    model: config.model,
    supportsDocuments: false,

    async complete(req: CompletionRequest): Promise<CompletionResult> {
      const toPart = (c: AiContent) => {
        switch (c.type) {
          case "text":
            return { type: "text", text: c.text };
          case "image":
            return {
              type: "image_url",
              image_url: {
                url: `data:${c.mediaType};base64,${c.dataBase64}`,
              },
            };
          case "document":
            throw new Error(
              `${config.model} is served over an OpenAI-compatible endpoint, which does not accept PDFs. Upload a CSV export, or set AI_PROVIDER=anthropic for document parsing.`,
            );
        }
      };

      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          max_completion_tokens: req.maxTokens,
          ...(req.effort ? { reasoning_effort: req.effort } : {}),
          ...(req.jsonSchema
            ? {
                response_format: {
                  type: "json_schema",
                  json_schema: {
                    name: req.jsonSchema.name,
                    schema: req.jsonSchema.schema,
                    strict: true,
                  },
                },
              }
            : {}),
          messages: [
            { role: "system", content: req.system },
            ...req.messages.map((m) => ({
              role: m.role,
              content: m.content.map(toPart),
            })),
          ],
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(
          `${base} returned ${res.status}${body ? `: ${body.slice(0, 300)}` : ""}`,
        );
      }

      const data = (await res.json()) as {
        choices?: Array<{
          message?: { content?: string | null; refusal?: string | null };
          finish_reason?: string;
        }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          prompt_tokens_details?: { cached_tokens?: number };
        };
      };

      const choice = data.choices?.[0];

      return {
        text: choice?.message?.content ?? "",
        refused: Boolean(choice?.message?.refusal),
        usage: {
          inputTokens: data.usage?.prompt_tokens ?? 0,
          outputTokens: data.usage?.completion_tokens ?? 0,
          // Caching is automatic and reported rather than requested here, so
          // `cacheSystem` is accepted and simply has no knob to turn.
          cacheReadTokens: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        },
      };
    },
  };
}
