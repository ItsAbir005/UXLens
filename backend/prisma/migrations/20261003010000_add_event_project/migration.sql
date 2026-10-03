-- AlterTable
ALTER TABLE "Event" ADD COLUMN "projectId" TEXT;

-- CreateIndex
CREATE INDEX "Event_projectId_timestamp_idx" ON "Event"("projectId", "timestamp");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;