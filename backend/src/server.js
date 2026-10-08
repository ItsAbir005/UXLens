import express from "express";
import { prisma } from "./db.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { hashIngestionKey } from "./project-key.js";

const app = express();
const port = process.env.PORT || 4000;
const trackerPath = fileURLToPath(new URL("../public/tracker.js", import.meta.url));
const eventTypes = new Set(["page_view", "click", "hover", "scroll", "navigation", "repeated_click"]);
const problemTypes = ["repeated_click", "dead_click", "hesitation", "backtracking"];
const eventRateLimit = 300;
const eventRateWindowMs = 60_000;
const eventRateBuckets = new Map();

const bearerKey = (req) => {
  const header = req.get("authorization");
  if (typeof header !== "string") return null;
  const match = header.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] || null;
};

const authenticateProject = async (req, res, expectedProjectId) => {
  const key = bearerKey(req);
  if (!key) {
    res.status(401).json({ error: "project ingestion key is required" });
    return null;
  }

  const hashedKey = hashIngestionKey(key);

  const credential = await prisma.projectCredential.findUnique({
    where: { ingestionKeyHash: hashedKey },
    include: { project: { select: { id: true, name: true, website: true, createdAt: true } } }
  });

  let project = null;
  if (credential && !credential.revokedAt) {
    project = credential.project;
  } else {
    project = await prisma.project.findFirst({
      where: { ingestionKeyHash: hashedKey },
      select: { id: true, name: true, website: true, createdAt: true }
    });
  }

  if (!project || (expectedProjectId && project.id !== expectedProjectId)) {
    res.status(403).json({ error: "project ingestion key is not valid for this project" });
    return null;
  }
  return project;
};

const checkEventRateLimit = (projectId, res) => {
  const now = Date.now();
  const existing = eventRateBuckets.get(projectId);
  const bucket = existing && now - existing.windowStartedAt < eventRateWindowMs
    ? existing
    : { windowStartedAt: now, count: 0 };

  if (bucket.count >= eventRateLimit) {
    const retryAfter = Math.max(1, Math.ceil((bucket.windowStartedAt + eventRateWindowMs - now) / 1000));
    res.set("Retry-After", String(retryAfter));
    res.status(429).json({ error: "event rate limit exceeded" });
    return false;
  }

  eventRateBuckets.set(projectId, bucket);
  return true;
};

const recordAcceptedEvent = (projectId) => {
  const bucket = eventRateBuckets.get(projectId);
  if (bucket) bucket.count += 1;
};

app.use(express.json({ limit: "32kb" }));
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
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

const listProjects = async (req, res) => {
  try {
    const projects = await prisma.project.findMany({ orderBy: { createdAt: 'desc' } });
    return res.json(projects);
  } catch (error) {
    console.error("Project list failed", error);
    return res.status(500).json({ error: "could not load projects" });
  }
};

app.get(["/projects", "/api/projects"], listProjects);

app.post("/projects", async (req, res) => {
  return res.status(401).json({ error: "project creation requires an authenticated management flow" });
});

const elementKey = (event) => {
  const element = event.element && typeof event.element === "object" ? event.element : {};
  return [event.page, element.id || element.text || element.role || element.tag || "unknown"].join("|");
};

const elementLabel = (event) => {
  const element = event.element && typeof event.element === "object" ? event.element : {};
  return element.text || element.id || element.role || element.tag || "Unknown element";
};

const buildProblems = (events) => {
  const problems = [];
  const repeatedGroups = new Map();
  const deadGroups = new Map();
  const hesitationGroups = new Map();
  const backtrackingGroups = new Map();
  const eventsBySession = new Map();

  for (const event of events) {
    if (!eventsBySession.has(event.sessionId)) eventsBySession.set(event.sessionId, []);
    eventsBySession.get(event.sessionId).push(event);
  }

  for (const event of events) {
    if (event.type === "repeated_click") {
      const key = elementKey(event);
      const group = repeatedGroups.get(key) || { event, occurrences: 0 };
      const metadata = event.metadata && typeof event.metadata === "object" ? event.metadata : {};
      group.occurrences += Number.isFinite(metadata.count) ? metadata.count : 1;
      repeatedGroups.set(key, group);
    }

    if (event.type === "click") {
      const metadata = event.metadata && typeof event.metadata === "object" ? event.metadata : {};
      const hoverToClickDuration = metadata.hoverToClickDuration;
      if (Number.isFinite(hoverToClickDuration) && hoverToClickDuration >= 3000) {
        const key = elementKey(event);
        const group = hesitationGroups.get(key) || { event, durations: [] };
        group.durations.push(hoverToClickDuration);
        hesitationGroups.set(key, group);
      }

      const sessionEvents = eventsBySession.get(event.sessionId) || [];
      const hasNearbyNavigation = sessionEvents.some((candidate) =>
        candidate.type === "navigation" &&
        candidate.timestamp > event.timestamp &&
        candidate.timestamp.getTime() - event.timestamp.getTime() <= 5000
      );
      if (!hasNearbyNavigation) {
        const key = elementKey(event);
        const group = deadGroups.get(key) || { event, occurrences: 0 };
        group.occurrences += 1;
        deadGroups.set(key, group);
      }
    }
  }

  const routeLabel = (route) => {
    if (typeof route !== "string" || !route) return null;
    try {
      return new URL(route, "http://uxlens.local").pathname;
    } catch {
      return route;
    }
  };

  for (const sessionEvents of eventsBySession.values()) {
    const navigationEvents = sessionEvents
      .filter((event) => event.type === "navigation")
      .sort((a, b) => a.timestamp - b.timestamp);

    for (let startIndex = 0; startIndex < navigationEvents.length; startIndex += 1) {
      const startMetadata = navigationEvents[startIndex].metadata;
      const startRoute = routeLabel(startMetadata?.from);
      if (!startRoute) continue;

      for (let returnIndex = startIndex; returnIndex < navigationEvents.length; returnIndex += 1) {
        const returnEvent = navigationEvents[returnIndex];
        const returnRoute = routeLabel(returnEvent.metadata?.to);
        if (returnRoute !== startRoute) continue;

        const routeSequence = [
          startRoute,
          ...navigationEvents
            .slice(startIndex, returnIndex + 1)
            .map((event) => routeLabel(event.metadata?.to))
            .filter(Boolean)
        ];
        const key = routeSequence.join("|");
        const group = backtrackingGroups.get(key) || {
          event: returnEvent,
          routeSequence,
          occurrences: 0
        };
        group.occurrences += 1;
        backtrackingGroups.set(key, group);
        break;
      }
    }
  }

  for (const { event, occurrences } of repeatedGroups.values()) {
    problems.push({
      id: `repeated-${elementKey(event)}`,
      type: "repeated_click",
      title: "Repeated clicking",
      severity: "high",
      occurrences,
      page: event.page,
      element: elementLabel(event),
      evidence: [`${occurrences} repeated clicks`, "Same element within a short window", "Interaction did not resolve immediately"]
    });
  }

  for (const { event, occurrences } of deadGroups.values()) {
    if (occurrences < 3) continue;
    problems.push({
      id: `dead-${elementKey(event)}`,
      type: "dead_click",
      title: "Potential dead click",
      severity: "medium",
      occurrences,
      page: event.page,
      element: elementLabel(event),
      evidence: [`${occurrences} clicks`, "No navigation detected within five seconds", "Same element"]
    });
  }

  for (const { event, durations } of hesitationGroups.values()) {
    const sortedDurations = [...durations].sort((a, b) => a - b);
    const middle = Math.floor(sortedDurations.length / 2);
    const median = sortedDurations.length % 2 === 1
      ? sortedDurations[middle]
      : (sortedDurations[middle - 1] + sortedDurations[middle]) / 2;
    const formattedDuration = median < 1000
      ? `${Math.round(median)}ms`
      : `${(median / 1000).toFixed(1)}s`;

    problems.push({
      id: `hesitation-${elementKey(event)}`,
      type: "hesitation",
      title: "Potential hesitation",
      severity: "medium",
      occurrences: durations.length,
      page: event.page,
      element: elementLabel(event),
      evidence: [
        `${durations.length} hesitation events`,
        `Median hover-to-click time: ${formattedDuration}`,
        "Hover-to-click delay may indicate uncertainty or hesitation"
      ]
    });
  }

  for (const { event, routeSequence, occurrences } of backtrackingGroups.values()) {
    problems.push({
      id: `backtracking-${routeSequence.join("-")}`,
      type: "backtracking",
      title: "Potential backtracking",
      severity: "medium",
      occurrences,
      page: routeSequence[routeSequence.length - 1],
      element: "Navigation",
      evidence: [
        routeSequence.join(" -> "),
        "Navigation returned to an earlier page",
        "This may indicate users are retracing their path"
      ]
    });
  }

  return problems.sort((a, b) => b.occurrences - a.occurrences);
};

const getProjectEvents = async (projectId) => prisma.event.findMany({
  where: { projectId },
  orderBy: { timestamp: "asc" },
  select: { id: true, sessionId: true, type: true, page: true, timestamp: true, element: true, metadata: true }
});

const loadProject = async (projectId, res) => {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    res.status(404).json({ error: "project not found" });
    return null;
  }
  return project;
};

app.get("/api/projects/:id/problems", async (req, res) => {
  try {
    const project = await loadProject(req.params.id, res);
    if (!project) return;
    const events = await getProjectEvents(project.id);
    const problems = buildProblems(events);
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
    }
    
    pairingWindows.set(project.id, Date.now() + 60000);
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
        return res.json({ id: project.id, ingestionKey: rawKey });
      }
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
    return res.status(400).json({ error: "projectId is required" });
  }

  const project = await authenticateProject(req, res, requestedProjectId);
  if (!project) return;
  if (!checkEventRateLimit(project.id, res)) return;

  if (
    typeof sessionId !== "string" || !sessionId ||
    typeof type !== "string" || !eventTypes.has(type) ||
    typeof page !== "string" || !page || page.length > 2048 ||
    typeof timestamp !== "number" || !Number.isFinite(timestamp) ||
    !Number.isFinite(new Date(timestamp).getTime()) ||
    typeof element !== "object" || element === null || Array.isArray(element) ||
    typeof metadata !== "object" || metadata === null || Array.isArray(metadata)
  ) {
    return res.status(400).json({ error: "sessionId, type, page, timestamp, element, and metadata are required" });
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
