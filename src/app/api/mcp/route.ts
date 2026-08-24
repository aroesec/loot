import { handleMcpRequest } from "@/lib/mcp/server";

/**
 * Remote MCP endpoint. Point a client at https://<deployment>/api/mcp with an
 * `Authorization: Bearer mb_…` header.
 *
 * Tool calls are short database round-trips, not agent turns — the agent loop
 * runs on the client's side.
 */
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  return handleMcpRequest(request);
}

// Streamable HTTP uses GET to open a server-initiated stream and DELETE to end
// a session. A stateless server supports neither, and the transport replies
// with the correct protocol-level error rather than a bare 404.
export async function GET(request: Request): Promise<Response> {
  return handleMcpRequest(request);
}

export async function DELETE(request: Request): Promise<Response> {
  return handleMcpRequest(request);
}
