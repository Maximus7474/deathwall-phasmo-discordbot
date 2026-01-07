-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guild" TEXT NOT NULL,
    "successfulRounds" INTEGER NOT NULL,
    "goal" INTEGER NOT NULL,
    "restrictionsPerRound" INTEGER NOT NULL DEFAULT 2,
    "finished" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" DATETIME,
    "finishedAt" DATETIME
);

-- CreateTable
CREATE TABLE "SessionRound" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ghostType" TEXT,
    "won" BOOLEAN,
    "sessionId" TEXT NOT NULL,
    "startedById" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "SessionRound_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SessionRound_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "SessionMember" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SessionMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "isLeader" BOOLEAN NOT NULL DEFAULT false,
    "sessionId" TEXT NOT NULL,
    CONSTRAINT "SessionMember_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Restriction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "occurences" INTEGER,
    "addedBy" TEXT NOT NULL,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SessionRestriction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" INTEGER NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "sessionId" TEXT NOT NULL,
    "restrictionId" TEXT NOT NULL,
    CONSTRAINT "SessionRestriction_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SessionRestriction_restrictionId_fkey" FOREIGN KEY ("restrictionId") REFERENCES "Restriction" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
