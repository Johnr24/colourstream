-- AlterTable
ALTER TABLE "UploadLink" ALTER COLUMN "maxUses" DROP NOT NULL,
ALTER COLUMN "maxUses" DROP DEFAULT;

-- AlterTable
ALTER TABLE "UploadedFile" ADD COLUMN     "hash" TEXT,
ALTER COLUMN "size" SET DATA TYPE DOUBLE PRECISION;
