import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const backendUrl = (process.env.BACKEND_URL || "http://localhost:4000").replace(/\/$/, "");
const ingestionKey = process.env.UXLENS_PROJECT_INGESTION_KEY;
const defaultProjectId = process.env.UXLENS_DEFAULT_PROJECT_ID;

function resolveProjectId(projectId) {
  const id = projectId || defaultProjectId;
  if (!id) {
    throw new Error("No projectId provided and UXLENS_DEFAULT_PROJECT_ID is not configured.");
  }
  return id;
}

function cleanProjectNameForVoice(name) {
  if (!name) return "the website";
  let clean = name.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").replace(/^www\./i, "");
  clean = clean.replace(/\.[a-z]{2,}$/i, "");
  return clean || "the website";
}

const problemDetailsShape = {
  projectId: z.string().min(1).optional().describe("The unique ID of the project"),
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
    { projectId: z.string().min(1).optional().describe("The unique ID of the project to analyze") }, 
    async ({ projectId }) => {
      try {
        const targetProjectId = resolveProjectId(projectId);
        const { project, summary, problems } = await requestBackend(`/api/projects/${encodeURIComponent(targetProjectId)}/problems`);
        const totalDetected = problems.reduce((sum, p) => sum + p.occurrences, 0);
        let overallHealth = "Good";
        if (totalDetected > 20) overallHealth = "Poor";
        else if (totalDetected > 5) overallHealth = "Fair";

        const site = cleanProjectNameForVoice(project.name);
        const spoken = `Overall user experience health for ${site} is ${overallHealth.toLowerCase()}. We recorded ${totalDetected} total friction events, including ${summary.dead_click || 0} dead clicks and ${summary.repeated_click || 0} repeated clicks.`.slice(0, 280);

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
          recommendedNextStep: "Use get_ux_problems to identify which pages or elements have the most severe issues.",
          spoken
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "get_ux_problems",
    "Use this when the user asks what UX problems exist, which problems are most common, or which pages have the most friction. Returns a summarized list of top detected friction areas.",
    { projectId: z.string().min(1).optional().describe("The unique ID of the project") }, 
    async ({ projectId }) => {
      try {
        const targetProjectId = resolveProjectId(projectId);
        const { project, problems } = await requestBackend(`/api/projects/${encodeURIComponent(targetProjectId)}/problems`);
        const topProblems = problems.slice(0, 10).map(({ id, type, title, severity, occurrences, page, element }) => ({
          id, type, title, severity, occurrences, page, element
        }));

        const site = cleanProjectNameForVoice(project.name);
        const topTypes = topProblems.slice(0, 3).map(p => p.type.replace(/_/g, " "));
        const spoken = problems.length === 0
          ? `No user experience problems were detected for ${site}. Everything is running smoothly.`
          : `Found ${problems.length} friction areas on ${site}. The most common issues are ${topTypes.join(", ")}.`.slice(0, 280);

        return jsonResult({
          summary: `Found ${problems.length} distinct problem areas. Showing top ${topProblems.length}.`,
          projectName: project.name,
          topProblems,
          recommendedNextStep: "Use get_problem_details with a specific problem ID or type to get evidence for why users are struggling there.",
          spoken
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
        const targetProjectId = resolveProjectId(projectId);
        const selector = problemId || problemType || problemTypeOrId;
        if (!selector) {
          return errorResult(new Error("Provide problemTypeOrId, problemType, or problemId."));
        }
        const { project, problems } = await requestBackend(`/api/projects/${encodeURIComponent(targetProjectId)}/problems`);
        const problem = problems.find(({ id, type }) => id === selector || type === selector);
        if (!problem) {
          return errorResult(new Error(`No UX problem found for "${selector}".`));
        }

        const typeName = (problem.type || "friction").replace(/_/g, " ");
        const rationale = problem.heuristic?.rationale || "Users experienced friction interacting with this part of the interface";
        const spoken = `Found ${problem.occurrences} instances of ${typeName}. ${rationale}.`.slice(0, 280);

        return jsonResult({
          summary: `Evidence for ${problem.title} on page ${problem.page}`,
          projectName: project.name,
          problemType: problem.type,
          elementAffected: problem.element,
          occurrences: problem.occurrences,
          evidence: problem.evidence,
          recommendedNextStep: "Use get_session_timeline to view the full journey of a user experiencing this problem, or summarize this evidence for the user.",
          spoken
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "get_design_suggestions",
    "Use this when the user asks for design suggestions, recommendations, or heuristic fixes for UX issues. Returns suggestions for the top 3 problem areas based on Nielsen heuristics.",
    { projectId: z.string().min(1).optional().describe("The unique ID of the project") },
    async ({ projectId }) => {
      try {
        const targetProjectId = resolveProjectId(projectId);
        const { project, problems } = await requestBackend(`/api/projects/${encodeURIComponent(targetProjectId)}/problems`);
        const top3 = (problems || []).slice(0, 3);
        const suggestions = top3.map((problem) => {
          const h = problem.heuristic || {
            id: 1,
            name: "Visibility of system status",
            suggestion: "Add immediate feedback or make interactive elements clear."
          };
          const typeLabel = (problem.type || "issue").replace(/_/g, " ");
          const suggestionText = h.suggestion || "Provide immediate visual feedback for user actions.";
          const spoken = `For ${typeLabel}, ${suggestionText.charAt(0).toLowerCase() + suggestionText.slice(1)}.`.slice(0, 280);
          return {
            type: problem.type,
            page: problem.page,
            heuristic: {
              id: h.id,
              name: h.name
            },
            suggestion: suggestionText,
            spoken
          };
        });

        return jsonResult({
          summary: `Top ${suggestions.length} design suggestions based on Nielsen heuristics.`,
          projectName: project.name,
          suggestions,
          spoken: (suggestions.map(s => s.spoken).join(" ") || "No design suggestions yet.").slice(0, 280)
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "get_session_timeline",
    "Use this when the user asks what a user did during a session, wants to understand a problematic journey, or asks if users are getting stuck before a specific step like checkout.",
    { projectId: z.string().min(1).optional().describe("The unique ID of the project") }, 
    async ({ projectId }) => {
      try {
        const targetProjectId = resolveProjectId(projectId);
        const { project, events } = await requestBackend(`/api/projects/${encodeURIComponent(targetProjectId)}/events`);
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
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/health", (_req, res) => res.json({ status: "ok" }));

const askRateLimits = new Map();
function checkAskRateLimit(ip) {
  const now = Date.now();
  const record = askRateLimits.get(ip);
  if (!record || now > record.resetAt) {
    askRateLimits.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (record.count >= 20) {
    return false;
  }
  record.count += 1;
  return true;
}

function ruleBasedAnswer(question, project, summary, problems) {
  const q = (question || "").toLowerCase();
  const site = cleanProjectNameForVoice(project?.name);

  if (/(problem|issue|wrong|friction)/.test(q)) {
    const topProblems = (problems || []).slice(0, 3);
    const topTypes = topProblems.map(p => (p.type || "").replace(/_/g, " "));
    return problems.length === 0
      ? `No user experience problems were detected for ${site}. Everything is running smoothly.`
      : `Found ${problems.length} friction areas on ${site}. The most common issues are ${topTypes.join(", ")}.`.slice(0, 280);
  }

  if (/(fix|suggest|improve|recommend|heuristic|design)/.test(q)) {
    const top = problems?.[0];
    if (!top) return "No design suggestions needed, no friction events recorded.";
    const h = top.heuristic || { name: "Visibility of system status", suggestion: "Add immediate feedback or clear instructions." };
    const typeLabel = (top.type || "issue").replace(/_/g, " ");
    return `For ${typeLabel}, Nielsen heuristic ${h.name} suggests: ${h.suggestion.charAt(0).toLowerCase() + h.suggestion.slice(1)}.`.slice(0, 280);
  }

  if (/(why|evidence|detail)/.test(q)) {
    const problem = problems?.[0];
    if (!problem) return "No evidence found because no UX problems have been detected yet.";
    const typeName = (problem.type || "friction").replace(/_/g, " ");
    const rationale = problem.heuristic?.rationale || "Users experienced friction interacting with this part of the interface";
    return `Found ${problem.occurrences} instances of ${typeName}. ${rationale}.`.slice(0, 280);
  }

  if (/(how|doing|health|score|summary|overall)/.test(q)) {
    const totalDetected = (problems || []).reduce((sum, p) => sum + p.occurrences, 0);
    let health = "good";
    if (totalDetected > 20) health = "poor";
    else if (totalDetected > 5) health = "fair";
    return `Overall user experience health for ${site} is ${health}. We recorded ${totalDetected} total friction events, including ${summary?.dead_click || 0} dead clicks and ${summary?.repeated_click || 0} repeated clicks.`.slice(0, 280);
  }

  return "I can summarize overall UX health, list friction problems, give design suggestions, or explain why users struggle. What would you like to know?";
}

app.post("/ask", async (req, res) => {
  const { question } = req.body ?? {};
  if (typeof question !== "string" || !question.trim() || question.length > 300) {
    return res.status(400).json({ error: "Invalid question. Question must be a non-empty string of at most 300 characters." });
  }

  const clientIp = req.ip || req.connection?.remoteAddress || "127.0.0.1";
  if (!checkAskRateLimit(clientIp)) {
    return res.status(429).json({ error: "Rate limit exceeded. Maximum 20 requests per minute." });
  }

  let project = { name: "website" };
  let summary = {};
  let problems = [];
  let events = [];

  try {
    const projId = defaultProjectId;
    if (projId) {
      const [problemsRes, eventsRes] = await Promise.all([
        requestBackend(`/api/projects/${encodeURIComponent(projId)}/problems`),
        requestBackend(`/api/projects/${encodeURIComponent(projId)}/events`)
      ]);
      project = problemsRes.project || project;
      summary = problemsRes.summary || summary;
      problems = problemsRes.problems || problems;
      events = eventsRes.events || events;
    }
  } catch {}

  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    return res.json({
      answer: ruleBasedAnswer(question, project, summary, problems),
      source: "rules"
    });
  }

  const pageCounts = {};
  for (const ev of events) {
    if (ev.page) pageCounts[ev.page] = (pageCounts[ev.page] || 0) + 1;
  }
  const topPages = Object.entries(pageCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([page, count]) => ({ page, count }));

  const recentNavigations = events
    .filter(ev => ev.type === "navigation" || ev.type === "page_view")
    .slice(-10)
    .map(ev => ({ type: ev.type, page: ev.page, from: ev.metadata?.from, to: ev.metadata?.to }));

  const context = {
    totalEvents: events.length,
    sessionCount: new Set(events.map(e => e.sessionId)).size,
    signalCounts: {
      dead_click: summary.dead_click || 0,
      repeated_click: summary.repeated_click || 0,
      hesitation: summary.hesitation || 0,
      backtracking: summary.backtracking || 0
    },
    problems: problems.slice(0, 5).map(p => ({
      type: p.type,
      page: p.page,
      element: p.element,
      occurrences: p.occurrences,
      evidence: p.evidence,
      heuristic: p.heuristic ? {
        id: p.heuristic.id,
        name: p.heuristic.name,
        rationale: p.heuristic.rationale,
        suggestion: p.heuristic.suggestion
      } : null
    })),
    topPages,
    recentNavigations
  };

  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const geminiRes = await fetch(geminiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": geminiApiKey
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text: "You are UXLens, a voice assistant that explains UX friction. Answer ONLY from the provided JSON data. Never invent numbers, pages or problems; if the data cannot answer, say so plainly. Answer the user's actual question (what, where, why, or how to fix), reference the relevant Nielsen heuristic by name when giving advice, and give concrete practical steps. Reply in at most 3 short plain sentences (under 400 characters), no markdown, no lists, no URLs. For unrelated questions, say what you can help with."
          }]
        },
        contents: [{
          parts: [{
            text: `UXLens Context Data:\n${JSON.stringify(context)}\n\nUser Question:\n${question}`
          }]
        }]
      }),
      signal: controller.signal
    });
    clearTimeout(timer);

    if (geminiRes.ok) {
      const geminiData = await geminiRes.json();
      const rawAnswer = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
      if (rawAnswer && typeof rawAnswer === "string" && rawAnswer.trim()) {
        const cleanAnswer = rawAnswer.trim().slice(0, 400);
        return res.json({ answer: cleanAnswer, source: "ai" });
      }
    }
    return res.json({
      answer: ruleBasedAnswer(question, project, summary, problems),
      source: "rules"
    });
  } catch {
    clearTimeout(timer);
    return res.json({
      answer: ruleBasedAnswer(question, project, summary, problems),
      source: "rules"
    });
  }
});

app.post("/mcp", async (req, res) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => { void transport.close(); void server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
app.get("/mcp", (_req, res) => res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }));

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`MCP server on http://localhost:${port}/mcp`));
