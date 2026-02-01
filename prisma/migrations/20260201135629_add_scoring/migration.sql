/*
  Warnings:

  - You are about to drop the column `number` on the `SessionRestriction` table. All the data in the column will be lost.
  - Added the required column `roundId` to the `SessionRestriction` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Session" ADD COLUMN "score" INTEGER;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Restriction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "occurences" INTEGER,
    "metadata" JSONB,
    "score" INTEGER NOT NULL DEFAULT 1,
    "addedBy" TEXT NOT NULL,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Restriction" ("addedAt", "addedBy", "id", "metadata", "occurences") SELECT "addedAt", "addedBy", "id", "metadata", "occurences" FROM "Restriction";
DROP TABLE "Restriction";
ALTER TABLE "new_Restriction" RENAME TO "Restriction";
CREATE TABLE "new_SessionRestriction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roundId" TEXT NOT NULL,
    "restrictionId" TEXT NOT NULL,
    "metadata" JSONB,
    "sessionId" TEXT,
    CONSTRAINT "SessionRestriction_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "SessionRound" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SessionRestriction_restrictionId_fkey" FOREIGN KEY ("restrictionId") REFERENCES "Restriction" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SessionRestriction_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SessionRestriction" ("id", "metadata", "restrictionId", "sessionId") SELECT "id", "metadata", "restrictionId", "sessionId" FROM "SessionRestriction";
DROP TABLE "SessionRestriction";
ALTER TABLE "new_SessionRestriction" RENAME TO "SessionRestriction";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
