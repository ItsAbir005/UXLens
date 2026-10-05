import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const backendUrl = (process.env.BACKEND_URL || "http://localhost:4000").replace(/\/$/, "");
const ingestionKey = process.env.UXLENS_PROJECT_INGESTION_KEY;

const problemDetailsShape = {
  projectId: z.string().min(1),
  problemTypeOrId: z.string().min(1).optional(),
  problemType: z.string().min(1).optional(),
  problemId: z.string().min(1).optional()
};

async function requestBackend(path) {
  if (!ingestionKey) throw new Error("UXLENS_PROJECT_INGESTION_KEY is not configured.");
  const response = await fetch(`${backendUrl}${path}`, {
    headers: { Authorization: `Bearer ${ingestionKey}` }
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error || `Backend request failed with status ${response.status}.`);
  }
  return body;
}

function jsonResult(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data
  };
}

function errorResult(error) {
  return {
    isError: true,
    content: [{ type: "text", text: error instanceof Error ? error.message : "Backend request failed." }]
  };
}

function buildServer() {
  const server = new McpServer({ name: "uxlens", version: "0.1.0" });
  server.tool("ping", { name: z.string().default("developer") }, async ({ name }) => ({
    content: [{ type: "text", text: `Hello ${name}, UXLens MCP is alive.` }]
  }));

  server.tool("get_ux_summary", { projectId: z.string().min(1) }, async ({ projectId }) => {
    try {
      const { project, summary, problems } = await requestBackend(`/api/projects/${encodeURIComponent(projectId)}/problems`);
      return jsonResult({
        project: { id: project.id, name: project.name },
        projectName: project.name,
        repeatedClickCount: summary.repeated_click || 0,
        deadClickCount: summary.dead_click || 0,
        hesitationCount: summary.hesitation || 0,
        backtrackingCount: summary.backtracking || 0,
        totalDetectedProblems: problems.length
      });
    } catch (error) {
      return errorResult(error);
    }
  });

  server.tool("get_ux_problems", { projectId: z.string().min(1) }, async ({ projectId }) => {
    try {
      const { project, problems } = await requestBackend(`/api/projects/${encodeURIComponent(projectId)}/problems`);
      return jsonResult({
        project: { id: project.id, name: project.name },
        projectName: project.name,
        problems: problems.map(({ type, title, severity, occurrences, page, element, evidence }) => ({
          type, title, severity, occurrences, page, element, evidence
        }))
      });
    } catch (error) {
      return errorResult(error);
    }
  });

  server.tool("get_problem_details", problemDetailsShape, async ({ projectId, problemTypeOrId, problemType, problemId }) => {
    try {
      const selector = problemId || problemType || problemTypeOrId;
      if (!selector) {
        return errorResult(new Error("Provide problemTypeOrId, problemType, or problemId."));
      }
      const { project, problems } = await requestBackend(`/api/projects/${encodeURIComponent(projectId)}/problems`);
      const problem = problems.find(({ id, type }) => id === selector || type === selector);
      if (!problem) {
        return errorResult(new Error(`No UX problem found for \"${selector}\".`));
      }
      return jsonResult({
        project: { id: project.id, name: project.name },
        projectName: project.name,
        problem
      });
    } catch (error) {
      return errorResult(error);
    }
  });

  server.tool("get_session_timeline", { projectId: z.string().min(1) }, async ({ projectId }) => {
    try {
      const { project, events } = await requestBackend(`/api/projects/${encodeURIComponent(projectId)}/events`);
      const meaningfulTypes = new Set(["page_view", "click", "navigation", "repeated_click"]);
      const timeline = events
        .filter(({ type }) => meaningfulTypes.has(type))
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
        .map(({ id, sessionId, type, page, timestamp, element, metadata }) => ({
          id, sessionId, type, page, timestamp, element, metadata
        }));
      return jsonResult({
        project: { id: project.id, name: project.name },
        projectName: project.name,
        events: timeline
      });
    } catch (error) {
      return errorResult(error);
    }
  });
  return server;
}

const app = express();
app.use(express.json());
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

app.get("/health", (_req, res) => res.json({ status: "ok" }));

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
