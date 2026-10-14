-- Acompanhamento da conta de anúncio do Meta (Central Meta Ads).
-- Só acréscimo: uma tabela nova; nenhuma tabela/coluna existente é alterada.

-- CreateTable
CREATE TABLE "ad_account_monitors" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "ad_account_id" TEXT NOT NULL,
    "ad_account_name" TEXT,
    "access_token_encrypted" TEXT NOT NULL,
    "token_expires_at" TIMESTAMP(3),
    "data_access_expires_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "alert_state" JSONB NOT NULL DEFAULT '{}',
    "last_check_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_account_monitors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ad_account_monitors_organization_id_key" ON "ad_account_monitors"("organization_id");

-- AddForeignKey
ALTER TABLE "ad_account_monitors" ADD CONSTRAINT "ad_account_monitors_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
