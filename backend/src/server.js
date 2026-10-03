import express from "express";
import { prisma } from "./db.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const app = express();
const port = process.env.PORT || 4000;
const trackerPath = fileURLToPath(new URL("../public/tracker.js", import.meta.url));
const eventTypes = new Set(["page_view", "click", "hover", "scroll", "navigation"]);

app.use(express.json());
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (_req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/tracker.js", async (_req, res) => {
  res.type("application/javascript").send(await readFile(trackerPath, "utf8"));
});

app.get("/health", async (_req, res) => {
  try {
    const projectCount = await prisma.project.count();
    res.json({ status: "ok", database: "connected", projectCount });
  } catch (error) {
    console.error("Database health check failed", error);
    res.status(503).json({ status: "error", database: "disconnected" });
  }
});

app.get("/projects", async (_req, res) => {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" }
  });
  res.json(projects);
});

app.post("/projects", async (req, res) => {
  const { name, website } = req.body;
  if (typeof name !== "string" || typeof website !== "string" || !name || !website) {
    return res.status(400).json({ error: "name and website are required" });
  }

  const project = await prisma.project.create({ data: { name, website } });
  return res.status(201).json(project);
});

app.post("/api/events", async (req, res) => {
  const { sessionId, type, page, timestamp, element = {}, metadata = {}, projectId } = req.body ?? {};
  const requestedProjectId = projectId || metadata.projectId;

  if (
    typeof sessionId !== "string" || !sessionId ||
    typeof type !== "string" || !eventTypes.has(type) ||
    typeof page !== "string" || !page ||
    typeof timestamp !== "number" || !Number.isFinite(timestamp) ||
    !Number.isFinite(new Date(timestamp).getTime()) ||
    typeof element !== "object" || element === null || Array.isArray(element) ||
    typeof metadata !== "object" || metadata === null || Array.isArray(metadata)
  ) {
    return res.status(400).json({ error: "sessionId, type, page, timestamp, element, and metadata are required" });
  }

  try {
    let sessionProjectId = typeof requestedProjectId === "string" ? requestedProjectId : undefined;
    const origin = typeof metadata.origin === "string" ? metadata.origin : undefined;

    if (sessionProjectId) {
      const project = await prisma.project.findUnique({ where: { id: sessionProjectId } });
      if (!project) return res.status(400).json({ error: "projectId does not exist" });
    } else if (origin) {
      const project = await prisma.project.findFirst({ where: { website: origin } }) || await prisma.project.create({
        data: { name: origin, website: origin }
      });
      sessionProjectId = project.id;
    }

    const session = await prisma.session.upsert({
      where: { id: sessionId },
      create: { id: sessionId, projectId: sessionProjectId || undefined },
      update: { projectId: sessionProjectId || undefined }
    });
    const event = await prisma.event.create({
      data: {
        sessionId: session.id,
        projectId: sessionProjectId,
        type,
        page,
        timestamp: new Date(timestamp),
        element,
        metadata
      }
    });
    return res.status(201).json({ id: event.id, sessionId: event.sessionId, type: event.type });
  } catch (error) {
    console.error("Event ingestion failed", error);
    return res.status(500).json({ error: "could not store event" });
  }
});

const server = app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});

const shutdown = async () => {
  await prisma.$disconnect();
  server.close();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
