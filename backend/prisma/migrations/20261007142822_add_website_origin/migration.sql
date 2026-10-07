/*
  Warnings:

  - A unique constraint covering the columns `[websiteOrigin]` on the table `Project` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "websiteOrigin" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Project_websiteOrigin_key" ON "Project"("websiteOrigin");
