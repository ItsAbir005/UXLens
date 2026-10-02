import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

function buildServer() {
  const server = new McpServer({ name: "uxlens", version: "0.1.0" });
  server.tool("ping", { name: z.string().default("developer") }, async ({ name }) => ({
    content: [{ type: "text", text: `Hello ${name}, UXLens MCP is alive.` }]
  }));
  server.tool("get_latest_workflow", { owner: z.string().min(1), repo: z.string().min(1) }, async ({ owner, repo }) => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(await getLatestWorkflow(owner, repo), null, 2) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Unable to fetch workflow run." }] };
    }
  });
  return server;
}

const app = express();
app.use(express.json());
app.post("/mcp", async (req, res) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => { void transport.close(); void server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
app.get("/mcp", (_req, res) => res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }));

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`MCP server on http://localhost:${port}/mcp`));
