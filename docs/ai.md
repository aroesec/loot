# Models

Optional. Here is precisely what you gain and lose.

| | With a model | Without |
|---|---|---|
| CSV import | works | works |
| Rule-based categorization | works | works |
| Learning from corrections | works | works |
| Unrecognized merchants | categorized by the model | go to the review queue |
| PDF / image statements | works (Anthropic only) | not available |
| Written-up insights | works | deterministic facts only |

Running without one is a supported configuration. You answer more rows by hand
early on, and each answer writes a rule, so it converges.

## Configuring

```bash
AI_PROVIDER="anthropic"     # or "openai"
AI_API_KEY="..."
AI_MODEL="claude-opus-5"
AI_BASE_URL=""              # only for OpenAI-compatible endpoints
```

The provider is inferred when you leave `AI_PROVIDER` unset: an `AI_BASE_URL`
pointing somewhere other than Anthropic means an OpenAI-compatible endpoint.

`ANTHROPIC_API_KEY` and `LLM_MODEL` still work — an existing deployment needs
no changes.

## Providers

**Anthropic.** The default, and the only one here that reads PDF statements.

```bash
AI_PROVIDER="anthropic"
AI_API_KEY="sk-ant-..."
AI_MODEL="claude-opus-5"
```

**OpenAI-compatible.** One adapter covers a large family, because they all
speak `/v1/chat/completions`:

```bash
# OpenAI
AI_PROVIDER="openai"
AI_API_KEY="sk-..."
AI_MODEL="gpt-4o-mini"

# OpenRouter
AI_BASE_URL="https://openrouter.ai/api/v1"
AI_MODEL="anthropic/claude-sonnet-4"

# Groq
AI_BASE_URL="https://api.groq.com/openai/v1"
AI_MODEL="llama-3.3-70b-versatile"

# Ollama — nothing leaves your machine
AI_API_KEY="ollama"
AI_BASE_URL="http://localhost:11434/v1"
AI_MODEL="llama3.1:8b"

# LM Studio
AI_BASE_URL="http://localhost:1234/v1"
```

## What a model needs to be able to do

Classification uses **structured output** — the reply is constrained to a JSON
Schema server-side, which is what lets the result be parsed without a repair
step. Both adapters enforce it.

A model too small to follow a schema will fail loudly rather than silently
miscategorize. If you are running something local and small, test on a handful
of transactions before trusting a bulk reclassify.

## Cost

Categorization is one call per 40 transactions, with the taxonomy in a cached
system prompt so repeated batches mostly pay for the transaction list. A
typical month of a few hundred transactions is a handful of calls.

Rules run first and for free, so the share reaching a model falls as it learns.
Payment rails never reach it at all — their descriptions cannot say what was
bought, so they go straight to the review queue rather than spending a call to
be told "unknown".

## Privacy

Transaction descriptions and amounts are sent to whichever provider you
configure. That includes merchant names and, on payment rails, counterparty
names.

If that is not acceptable, you have two options that both work fully: run a
local model through Ollama or LM Studio, or run with no provider at all and
categorize by rule and by hand.
