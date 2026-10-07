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
  const headers = {};
  if (ingestionKey) headers.Authorization = `Bearer ${ingestionKey}`;
  const response = await fetch(`${backendUrl}${path}`, { headers });
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
  
  server.tool(
    "ping",
    "A simple ping tool to verify MCP is alive.",
    { name: z.string().default("developer") }, 
    async ({ name }) => ({
      content: [{ type: "text", text: `Hello ${name}, UXLens MCP is alive.` }]
    })
  );

  server.tool(
    "get_ux_summary",
    "Use this when the user asks for an overall assessment of website UX friction. Answers general health questions. Returns high-level metrics and aggregate counts of issues found. Do not overclaim scientific certainty.",
    { projectId: z.string().min(1).describe("The unique ID of the project to analyze") }, 
    async ({ projectId }) => {
      try {
        const { project, summary, problems } = await requestBackend(`/api/projects/${encodeURIComponent(projectId)}/problems`);
        const totalDetected = problems.reduce((sum, p) => sum + p.occurrences, 0);
        let overallHealth = "Good";
        if (totalDetected > 20) overallHealth = "Poor";
        else if (totalDetected > 5) overallHealth = "Fair";

        return jsonResult({
          summary: `Overall UX Health appears ${overallHealth}. Detected ${totalDetected} total potential friction events.`,
          projectName: project.name,
          metrics: {
            repeatedClickCount: summary.repeated_click || 0,
            deadClickCount: summary.dead_click || 0,
            hesitationCount: summary.hesitation || 0,
            backtrackingCount: summary.backtracking || 0,
            totalDetectedProblemAreas: problems.length
          },
          recommendedNextStep: "Use get_ux_problems to identify which pages or elements have the most severe issues."
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "get_ux_problems",
    "Use this when the user asks what UX problems exist, which problems are most common, or which pages have the most friction. Returns a summarized list of top detected friction areas.",
    { projectId: z.string().min(1).describe("The unique ID of the project") }, 
    async ({ projectId }) => {
      try {
        const { project, problems } = await requestBackend(`/api/projects/${encodeURIComponent(projectId)}/problems`);
        const topProblems = problems.slice(0, 10).map(({ id, type, title, severity, occurrences, page, element }) => ({
          id, type, title, severity, occurrences, page, element
        }));

        return jsonResult({
          summary: `Found ${problems.length} distinct problem areas. Showing top ${topProblems.length}.`,
          projectName: project.name,
          topProblems,
          recommendedNextStep: "Use get_problem_details with a specific problem ID or type to get evidence for why users are struggling there."
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "get_problem_details",
    "Use this when the user wants evidence or details about a specific UX problem (e.g. why users are struggling with a button). Answers 'Why are users struggling on X?' or 'Show me evidence'.",
    problemDetailsShape, 
    async ({ projectId, problemTypeOrId, problemType, problemId }) => {
      try {
        const selector = problemId || problemType || problemTypeOrId;
        if (!selector) {
          return errorResult(new Error("Provide problemTypeOrId, problemType, or problemId."));
        }
        const { project, problems } = await requestBackend(`/api/projects/${encodeURIComponent(projectId)}/problems`);
        const problem = problems.find(({ id, type }) => id === selector || type === selector);
        if (!problem) {
          return errorResult(new Error(`No UX problem found for "${selector}".`));
        }
        return jsonResult({
          summary: `Evidence for ${problem.title} on page ${problem.page}`,
          projectName: project.name,
          problemType: problem.type,
          elementAffected: problem.element,
          occurrences: problem.occurrences,
          evidence: problem.evidence,
          recommendedNextStep: "Use get_session_timeline to view the full journey of a user experiencing this problem, or summarize this evidence for the user."
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "get_session_timeline",
    "Use this when the user asks what a user did during a session, wants to understand a problematic journey, or asks if users are getting stuck before a specific step like checkout.",
    { projectId: z.string().min(1).describe("The unique ID of the project") }, 
    async ({ projectId }) => {
      try {
        const { project, events } = await requestBackend(`/api/projects/${encodeURIComponent(projectId)}/events`);
        const meaningfulTypes = new Set(["page_view", "click", "navigation", "repeated_click"]);
        const timeline = events
          .filter(({ type }) => meaningfulTypes.has(type))
          .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
          .slice(-20) // Limit to avoid huge raw event dumps
          .map(({ type, page, element, metadata }) => {
            const label = element?.text || element?.tagName || element?.id || "Unknown Element";
            const target = (type === 'click' || type === 'repeated_click') ? label : undefined;
            const context = metadata?.to ? `Navigated to ${metadata.to}` : undefined;
            return { action: type, location: page, target, context };
          });

        return jsonResult({
          summary: "Recent timeline of significant user actions (limited to last 20 events).",
          projectName: project.name,
          evidence: timeline,
          recommendedNextStep: "Analyze the sequence of clicks and navigations to identify where the user journey breaks down or loops."
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

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
