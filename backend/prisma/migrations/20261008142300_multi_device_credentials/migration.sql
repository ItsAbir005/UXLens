-- CreateTable
CREATE TABLE "ProjectCredential" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ingestionKeyHash" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectCredential_ingestionKeyHash_key" ON "ProjectCredential"("ingestionKeyHash");

-- CreateIndex
CREATE INDEX "ProjectCredential_projectId_idx" ON "ProjectCredential"("projectId");

-- AddForeignKey
ALTER TABLE "ProjectCredential" ADD CONSTRAINT "ProjectCredential_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
