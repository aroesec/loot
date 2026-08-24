import { checkAddress } from "@/lib/http/guard";
import {
  consume,
  limitHeaders,
  POLICIES,
  type LimitVerdict,
} from "@/lib/http/rate-limit";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { TOOLS, toolResult, toolError } from "./tools";
import { bearerFrom, resolveMcpToken } from "./tokens";

/**
 * Loot exposed as a remote MCP server.
 *
 * Stateless: every serverless invocation is a fresh process, so there is no
 * server-side session to resume into. One HTTP request per tool call, which is
 * what makes this deployable to Vercel at all.
 *
 * The database credentials live in this function's environment and never reach
 * the calling client, so the only thing a caller can do is what the tools
 * allow — read, log, and correct. There is no delete.
 */

export function buildServer(): McpServer {
  const server = new McpServer(
    { name: "loot", version: "0.1.0" },
    {
      instructions:
        "The person's personal finance ledger: what they have spent, on what, and what it means. " +
        "When they mention buying something, log it with log_purchase — entries are matched to the real charge when their statement arrives, so logging is always safe and never double-counts. " +
        "When they ask about their money, read from the ledger rather than guessing; every figure these tools return is computed from their own transactions.",
    },
  );

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: {
          readOnlyHint: tool.readOnly,
          // Nothing here deletes, so no tool is destructive in the MCP sense.
          destructiveHint: false,
          // log_purchase is idempotent in effect: calling it twice for the
          // same charge reports the existing row rather than adding another.
          idempotentHint: tool.readOnly || tool.name === "log_purchase",
          openWorldHint: false,
        },
      },
      async (args: Record<string, unknown>) => {
        try {
          return toolResult(await tool.handler(args ?? {}));
        } catch (error) {
          // Returned as an error result rather than thrown: the model can read
          // the message and adjust, where a transport failure would just look
          // like the tool being broken.
          return toolError(error);
        }
      },
    );
  }

  return server;
}

function jsonRpcError(status: number, code: number, message: string): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }),
    {
      status,
      headers: {
        "content-type": "application/json",
        // Prompts a compliant MCP client to attach credentials.
        ...(status === 401
          ? { "www-authenticate": 'Bearer realm="loot"' }
          : {}),
      },
    },
  );
}

/**
 * A rate-limit refusal in the shape an MCP client expects.
 *
 * Every response on this endpoint is parsed as JSON-RPC, so the plain
 * `{ error }` body the HTTP guard returns reads as a malformed reply rather
 * than "slow down" — the client reports a protocol error instead of backing
 * off. Both the credential limit and the tool-call ceiling come through here.
 */
function rateLimited(verdict: LimitVerdict): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: `Rate limited. Retry in ${verdict.retryAfter}s.`,
      },
      id: null,
    }),
    {
      status: 429,
      headers: { "content-type": "application/json", ...limitHeaders(verdict) },
    },
  );
}

/** Handles one MCP request end to end: authenticate, then dispatch. */
export async function handleMcpRequest(request: Request): Promise<Response> {
  const identity = await resolveMcpToken(
    bearerFrom(request.headers.get("authorization")),
  );

  if (!identity) {
    /*
     * Counted only on failure. A working client makes hundreds of legitimate
     * calls on one token and must never be throttled by this; someone guessing
     * tokens gets ten tries per address per quarter hour.
     */
    const attempt = checkAddress(request, POLICIES.badCredential);
    if (!attempt.allowed) return rateLimited(attempt);

    // Deliberately does not distinguish absent from invalid from revoked.
    return jsonRpcError(
      401,
      -32001,
      "Unauthorized: a valid Loot bearer token is required.",
    );
  }

  /*
   * A ceiling on tool calls once the token is good. An agent legitimately makes
   * many small reads in a turn, so this is set well above normal use — it stops
   * a client stuck in a retry loop from hammering the database, nothing more.
   *
   * Keyed on the token's identity rather than the address, so one misbehaving
   * client cannot shed another's traffic.
   */
  const calls = consume(identity.tokenId, POLICIES.mcp);
  if (!calls.allowed) return rateLimited(calls);

  const server = buildServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  });

  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}
