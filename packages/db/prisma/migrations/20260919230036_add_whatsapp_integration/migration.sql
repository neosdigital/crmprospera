-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'WHATSAPP_SENT';
ALTER TYPE "AuditAction" ADD VALUE 'WHATSAPP_FAILED';

-- CreateTable
CREATE TABLE "whatsapp_integrations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "phone_number_id" TEXT NOT NULL,
    "display_phone_number" TEXT,
    "access_token_encrypted" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_message_at" TIMESTAMP(3),
    "last_error_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_integrations_organization_id_key" ON "whatsapp_integrations"("organization_id");

-- AddForeignKey
ALTER TABLE "whatsapp_integrations" ADD CONSTRAINT "whatsapp_integrations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
