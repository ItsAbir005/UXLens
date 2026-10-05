import { prisma } from "../src/db.js";
import { generateIngestionKey, hashIngestionKey } from "../src/project-key.js";

const projectId = process.argv[2];

if (!projectId) {
  console.error("Usage: npm run project:key -- PROJECT_ID");
  process.exitCode = 1;
} else {
  try {
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true } });
    if (!project) throw new Error(`Project not found: ${projectId}`);

    const ingestionKey = generateIngestionKey();
    await prisma.project.update({
      where: { id: project.id },
      data: { ingestionKeyHash: hashIngestionKey(ingestionKey) }
    });

    console.log(`Project: ${project.name} (${project.id})`);
    console.log("Ingestion key (store it securely; it will not be shown again):");
    console.log(ingestionKey);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Could not generate project key.");
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}