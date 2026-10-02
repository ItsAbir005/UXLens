import express from "express";
import { prisma } from "./db.js";

const app = express();
const port = process.env.PORT || 4000;

app.use(express.json());
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
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

const server = app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});

const shutdown = async () => {
  await prisma.$disconnect();
  server.close();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
