import express from "express";
import crypto from "crypto";
import { PrismaClient } from "@prisma/client";

const app = express();
const port = process.env.PORT || 4000;
const prisma = new PrismaClient();

app.set("trust proxy", 1);
app.use(express.json());

// Enable CORS for frontend
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// Request logger for specific routes
app.use((req, res, next) => {
  if (req.path === "/api/sites/analyze" || req.path === "/api/sites/resolve" || req.path === "/api/events") {
    const start = Date.now();
    const originalSend = res.send;
    res.send = function (body) {
      res.locals.body = body;
      originalSend.call(this, body);
    };
    res.on("finish", () => {
      const ms = Date.now() - start;
      const origin = req.body?.origin || req.body?.projectId || req.params?.id || "-";
      console.log(`[HTTP] ${new Date().toISOString()} ${req.method} ${req.path} | IP: ${req.ip} | Target: ${origin} | Status: ${res.statusCode} | ${ms}ms`);
    });
  }
  next();
});

const hashIngestionKey = (key) => crypto.createHash("sha256").update(key).digest("hex");

const authenticateProject = async (req, res, requestedProjectId) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "missing or invalid authorization header" });
    console.log(`[AUTH FAIL] projectId=${requestedProjectId}: missing/invalid header`);
    return null;
  }
  
  const token = authHeader.split(" ")[1];
  const hashedToken = hashIngestionKey(token);

  try {
    const credential = await prisma.projectCredential.findUnique({
      where: { ingestionKeyHash: hashedToken },
      include: { project: true }
    });

    if (!credential) {
      res.status(401).json({ error: "invalid ingestion key" });
      console.log(`[AUTH FAIL] projectId=${requestedProjectId}: invalid ingestion key`);
      return null;
    }
    
    if (credential.revokedAt) {
      res.status(403).json({ error: "ingestion key revoked" });
      console.log(`[AUTH FAIL] projectId=${requestedProjectId}: ingestion key revoked`);
      return null;
    }
    
    if (credential.projectId !== requestedProjectId) {
      res.status(403).json({ error: "ingestion key not valid for this project" });
      console.log(`[AUTH FAIL] projectId=${requestedProjectId}: ingestion key belongs to different project (${credential.projectId})`);
      return null;
    }

    await prisma.projectCredential.update({
      where: { id: credential.id },
      data: { lastUsedAt: new Date() }
    });
    
    return credential.project;
  } catch (error) {
    console.error("Authentication failed", error);
    res.status(500).json({ error: "internal server error during authentication" });
    return null;
  }
};

const problemTypes = ["repeated_click", "rapid_navigation"];
const eventTypes = new Set(["page_view", "click", "hover", "scroll", "navigation", "repeated_click"]);
const eventRateLimitBuckets = new Map();
const eventRateLimit = 1000;
const eventRateWindowMs = 60 * 1000;

const checkEventRateLimit = (projectId, res) => {
  const now = Date.now();
  const existing = eventRateLimitBuckets.get(projectId);
  const bucket = existing && now - existing.windowStartedAt < eventRateWindowMs
    ? existing
    : { windowStartedAt: now, count: 0 };
  
  if (bucket.count >= eventRateLimit) {
    res.status(429).json({ error: "rate limit exceeded" });
    console.log(`[RATE LIMIT] projectId=${projectId}: 429 exceeded (${bucket.count}/${eventRateLimit})`);
    return false;
  }
  bucket.count += 1;
  eventRateLimitBuckets.set(projectId, bucket);
  return true;
};

const recordAcceptedEvent = (projectId) => {
  const now = Date.now();
  const existing = eventRateLimitBuckets.get(projectId);
  if (existing && now - existing.windowStartedAt < eventRateWindowMs) {
    existing.count += 1;
  } else {
    eventRateLimitBuckets.set(projectId, { windowStartedAt: now, count: 1 });
  }
};

const loadProject = async (id, res) => {
  try {
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      res.status(404).json({ error: "project not found" });
      return null;
    }
    return project;
  } catch (error) {
    res.status(500).json({ error: "internal server error" });
    return null;
  }
};

const getProjectProblems = async (projectId) => prisma.problem.findMany({ where: { projectId } });
const getProjectEvents = async (projectId) => prisma.event.findMany({ where: { projectId }, orderBy: { timestamp: "desc" } });

app.get("/api/projects", async (req, res) => {
  try {
    const projects = await prisma.project.findMany();
    return res.json(projects);
  } catch (error) {
    console.error("Project list failed", error);
    return res.status(500).json({ error: "could not load projects" });
  }
});

app.get("/api/projects/:id/problems", async (req, res) => {
  try {
    const project = await loadProject(req.params.id, res);
    if (!project) return;
    const problems = await getProjectProblems(project.id);
    const events = await getProjectEvents(project.id);
    const summary = Object.fromEntries(problemTypes.map((type) => [
      type,
      problems.filter((problem) => problem.type === type).reduce((total, problem) => total + problem.occurrences, 0)
    ]));
    const totalEvents = events.length;
    const totalSessions = new Set(events.map(e => e.sessionId)).size;
    return res.json({ project, summary, problems, totalEvents, totalSessions });
  } catch (error) {
    console.error("Problem query failed", error);
    return res.status(500).json({ error: "could not load problems" });
  }
});

app.get("/api/projects/:id/events", async (req, res) => {
  try {
    const project = await loadProject(req.params.id, res);
    if (!project) return;
    const events = await getProjectEvents(project.id);
    const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : undefined;
    const filteredEvents = sessionId ? events.filter((event) => event.sessionId === sessionId) : events;
    return res.json({ project, events: filteredEvents.slice(-100).reverse() });
  } catch (error) {
    console.error("Event query failed", error);
    return res.status(500).json({ error: "could not load events" });
  }
});

const siteResolveBuckets = new Map();
const resolveRateLimit = 10;
const resolveRateWindowMs = 60 * 1000;

const checkSiteResolveRateLimit = (ip, res) => {
  const now = Date.now();
  const existing = siteResolveBuckets.get(ip);
  const bucket = existing && now - existing.windowStartedAt < resolveRateWindowMs
    ? existing
    : { windowStartedAt: now, count: 0 };
  
  if (bucket.count >= resolveRateLimit) {
    res.status(429).json({ error: "site resolve rate limit exceeded" });
    return false;
  }
  bucket.count += 1;
  siteResolveBuckets.set(ip, bucket);
  return true;
};

const pairingWindows = new Map();
const PAIRING_WINDOW_MS = 60000;

app.post("/api/sites/analyze", async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (!checkSiteResolveRateLimit(ip, res)) return;

  const { origin } = req.body ?? {};
  if (typeof origin !== "string" || !origin) return res.status(400).json({ error: "origin is required" });

  let normalizedOrigin;
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
    normalizedOrigin = url.origin;
  } catch (err) {
    return res.status(400).json({ error: "invalid origin" });
  }

  try {
    let project = await prisma.project.findUnique({ where: { websiteOrigin: normalizedOrigin } });
    let created = false;
    
    if (!project) {
      const existingUnlinked = await prisma.project.findFirst({ 
        where: { website: normalizedOrigin, websiteOrigin: null } 
      });
      if (existingUnlinked) {
        project = await prisma.project.update({ 
          where: { id: existingUnlinked.id }, 
          data: { websiteOrigin: normalizedOrigin } 
        });
      }
    }

    if (!project) {
      const rawKey = crypto.randomBytes(32).toString("hex");
      project = await prisma.project.create({
        data: {
          name: normalizedOrigin,
          website: normalizedOrigin,
          websiteOrigin: normalizedOrigin,
          credentials: {
            create: { ingestionKeyHash: hashIngestionKey(rawKey) }
          }
        }
      });
      created = true;
    }
    
    const windowEnd = Date.now() + PAIRING_WINDOW_MS;
    pairingWindows.set(project.id, windowEnd);
    
    console.log(`[ANALYZE] normalizedOrigin=${normalizedOrigin}, project ${created ? "created" : "found"} (${project.id}). Pairing window opened for project ${project.id} until ${new Date(windowEnd).toISOString()}.`);

    return res.json({ id: project.id, name: project.name, website: project.website });
  } catch (error) {
    console.error("Site analyze failed", error);
    return res.status(500).json({ error: "could not analyze site" });
  }
});

app.post("/api/sites/resolve", async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (!checkSiteResolveRateLimit(ip, res)) return;

  const { origin } = req.body ?? {};
  if (typeof origin !== "string" || !origin) {
    return res.status(400).json({ error: "origin is required" });
  }

  let normalizedOrigin;
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
    normalizedOrigin = url.origin;
  } catch (err) {
    return res.status(400).json({ error: "invalid origin" });
  }

  try {
    let project = await prisma.project.findUnique({ where: { websiteOrigin: normalizedOrigin } });
    let created = false;
    
    // Migrate existing projects (e.g. Tracker Test Website)
    if (!project) {
      const existingUnlinked = await prisma.project.findFirst({ 
        where: { website: normalizedOrigin, websiteOrigin: null } 
      });
      if (existingUnlinked) {
        project = await prisma.project.update({ 
          where: { id: existingUnlinked.id }, 
          data: { websiteOrigin: normalizedOrigin } 
        });
      }
    }

    if (project) {
      const windowExpires = pairingWindows.get(project.id);
      if (windowExpires && Date.now() < windowExpires) {
        // Pairing window is open, generate a new key and give it to the extension
        const rawKey = crypto.randomBytes(32).toString("hex");
        await prisma.projectCredential.create({
          data: {
            projectId: project.id,
            ingestionKeyHash: hashIngestionKey(rawKey)
          }
        });
        pairingWindows.delete(project.id);
        console.log(`[RESOLVE] origin=${normalizedOrigin}, project found. Window OPEN. ingestion key ISSUED.`);
        return res.json({ id: project.id, ingestionKey: rawKey });
      }
      console.log(`[RESOLVE] origin=${normalizedOrigin}, project found. Window CLOSED/NOT PRESENT. ingestion key NOT issued.`);
      return res.json({ id: project.id });
    }

    const rawKey = crypto.randomBytes(32).toString("hex");
    const hashedKey = hashIngestionKey(rawKey);

    project = await prisma.project.create({
      data: {
        name: normalizedOrigin,
        website: normalizedOrigin,
        websiteOrigin: normalizedOrigin,
        credentials: {
          create: { ingestionKeyHash: hashedKey }
        }
      }
    });

    console.log(`[RESOLVE] origin=${normalizedOrigin}, project created. Window N/A. ingestion key ISSUED.`);
    return res.status(201).json({ id: project.id, ingestionKey: rawKey });
  } catch (error) {
    console.error("Site resolve failed", error);
    return res.status(500).json({ error: "could not resolve site" });
  }
});

app.post("/api/events", async (req, res) => {
  const { sessionId, type, page, timestamp, element = {}, metadata = {}, projectId } = req.body ?? {};
  const requestedProjectId = projectId || metadata.projectId;

  if (typeof requestedProjectId !== "string" || !requestedProjectId) {
    console.log(`[EVENT FAIL] missing projectId`);
    return res.status(400).json({ error: "projectId is required" });
  }

  const project = await authenticateProject(req, res, requestedProjectId);
  if (!project) return;
  if (!checkEventRateLimit(project.id, res)) return;

  if (typeof sessionId !== "string" || !sessionId) {
    console.log(`[EVENT FAIL] projectId=${project.id}, missing/invalid sessionId`);
    return res.status(400).json({ error: "sessionId is required" });
  }
  if (typeof type !== "string" || !eventTypes.has(type)) {
    console.log(`[EVENT FAIL] projectId=${project.id}, invalid type=${type}`);
    return res.status(400).json({ error: "invalid type" });
  }
  if (typeof page !== "string" || !page || page.length > 2048) {
    console.log(`[EVENT FAIL] projectId=${project.id}, invalid page=${page}`);
    return res.status(400).json({ error: "invalid page" });
  }
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp) || !Number.isFinite(new Date(timestamp).getTime())) {
    console.log(`[EVENT FAIL] projectId=${project.id}, invalid timestamp=${timestamp}`);
    return res.status(400).json({ error: "invalid timestamp" });
  }
  if (typeof element !== "object" || element === null || Array.isArray(element)) {
    console.log(`[EVENT FAIL] projectId=${project.id}, invalid element`);
    return res.status(400).json({ error: "invalid element" });
  }
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    console.log(`[EVENT FAIL] projectId=${project.id}, invalid metadata`);
    return res.status(400).json({ error: "invalid metadata" });
  }

  recordAcceptedEvent(project.id);

  try {
    const session = await prisma.session.upsert({
      where: { id: sessionId },
      create: { id: sessionId, projectId: project.id },
      update: { projectId: project.id }
    });
    const event = await prisma.event.create({
      data: {
        sessionId: session.id,
        projectId: project.id,
        type,
        page,
        timestamp: new Date(timestamp),
        element,
        metadata
      }
    });
    console.log(`[EVENT OK] projectId=${project.id}, type=${type}, id=${event.id}`);
    return res.status(201).json({ id: event.id, sessionId: event.sessionId, type: event.type });
  } catch (error) {
    console.error("Event ingestion failed", error);
    return res.status(500).json({ error: "could not store event" });
  }
});

const server = app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
  console.log(`[STARTUP] Event Rate Limit: ${eventRateLimit} per ${eventRateWindowMs / 1000}s. Pairing Window: ${PAIRING_WINDOW_MS / 1000}s.`);
});

const shutdown = async () => {
  await prisma.$disconnect();
  server.close();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);