ALTER TABLE "Project" ADD COLUMN "ingestionKeyHash" TEXT;

CREATE UNIQUE INDEX "Project_ingestionKeyHash_key" ON "Project"("ingestionKeyHash");