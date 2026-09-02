-- AlterTable
ALTER TABLE "share_grants" ADD COLUMN "canPreview" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "share_invites" ADD COLUMN "canPreview" BOOLEAN NOT NULL DEFAULT false;

-- DropTable
DROP TABLE "preview_grants";
DROP TABLE "preview_invites";
DROP TABLE "preview_sessions";
