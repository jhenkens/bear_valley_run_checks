-- CreateTable
CREATE TABLE "BoardItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "description" TEXT NOT NULL,
    "section" TEXT NOT NULL DEFAULT 'General',
    "authorName" TEXT NOT NULL,
    "authorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "isTask" BOOLEAN NOT NULL DEFAULT false,
    "dueDate" TEXT,
    "dueHour" INTEGER,
    "assignee" TEXT,
    "doneAt" DATETIME,
    "doneBy" TEXT,
    "debriefDate" TEXT,
    "morningBriefDate" TEXT,
    "archivedAt" DATETIME,
    "archivedToSheet" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "BoardPhoto" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "itemId" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "driveFileId" TEXT,
    "driveUrl" TEXT,
    CONSTRAINT "BoardPhoto_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "BoardItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BoardItem_archivedAt_idx" ON "BoardItem"("archivedAt");

-- CreateIndex
CREATE INDEX "BoardPhoto_itemId_idx" ON "BoardPhoto"("itemId");
