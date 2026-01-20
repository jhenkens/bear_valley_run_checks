-- CreateTable
CREATE TABLE "GoogleOAuth" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "tokenExpiresAt" DATETIME NOT NULL,
    "googleEmail" TEXT NOT NULL,
    "googleDriveFolderId" TEXT NOT NULL,
    "googleSheetsId" TEXT,
    "lastTestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GoogleOAuth_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "GoogleOAuth_userId_key" ON "GoogleOAuth"("userId");

-- CreateIndex
CREATE INDEX "GoogleOAuth_userId_idx" ON "GoogleOAuth"("userId");
