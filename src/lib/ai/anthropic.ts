import Anthropic from "@anthropic-ai/sdk";
import type {
  AiContent,
  AiProvider,
  CompletionRequest,
  CompletionResult,
} from "./types";

function toBlock(c: AiContent): Anthropic.ContentBlockParam {
  switch (c.type) {
    case "text":
      return { type: "text", text: c.text };
    case "image":
      return {
        type: "image",
        source: {
          type: "base64",
          media_type: c.mediaType as "image/png",
          data: c.dataBase64,
        },
      };
    case "document":
      return {
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: c.dataBase64,
        },
      };
  }
}

export function anthropicProvider(config: {
  apiKey: string;
  model: string;
  baseUrl?: string | null;
}): AiProvider {
  const client = new Anthropic({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
  });

  return {
    id: "anthropic",
    model: config.model,
    supportsDocuments: true,

    async complete(req: CompletionRequest): Promise<CompletionResult> {
      const message = await client.messages.create({
        model: config.model,
        max_tokens: req.maxTokens,
        ...(req.jsonSchema || req.effort
          ? {
              output_config: {
                ...(req.effort ? { effort: req.effort } : {}),
                ...(req.jsonSchema
                  ? {
                      format: {
                        type: "json_schema" as const,
                        schema: req.jsonSchema.schema,
                      },
                    }
                  : {}),
              },
            }
          : {}),
        system: [
          {
            type: "text",
            text: req.system,
            // Identical across a batch, so caching it turns the taxonomy into
            // a fixed cost rather than a per-call one.
            ...(req.cacheSystem
              ? { cache_control: { type: "ephemeral" as const } }
              : {}),
          },
        ],
        messages: req.messages.map((m) => ({
          role: m.role,
          content: m.content.map(toBlock),
        })),
      } as Anthropic.MessageCreateParamsNonStreaming);

      const text = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");

      return {
        text,
        refused: message.stop_reason === "refusal",
        usage: {
          inputTokens: message.usage?.input_tokens ?? 0,
          outputTokens: message.usage?.output_tokens ?? 0,
          cacheReadTokens: message.usage?.cache_read_input_tokens ?? 0,
        },
      };
    },
  };
}
