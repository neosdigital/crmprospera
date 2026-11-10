-- Área do Corretor (captação particular pelo Meta). Migração 100% aditiva: só cria tabelas
-- novas; nenhuma tabela/coluna existente é alterada, renomeada ou apagada.

-- CreateTable
CREATE TABLE "broker_personal_access" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "broker_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "enabled_at" TIMESTAMP(3),
    "disabled_at" TIMESTAMP(3),
    "updated_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "broker_personal_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broker_meta_connections" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "broker_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "account_owner_name" TEXT,
    "page_id" TEXT NOT NULL,
    "page_name" TEXT,
    "ad_account_id" TEXT,
    "ad_account_name" TEXT,
    "access_token_encrypted" TEXT NOT NULL,
    "token_expires_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_sync_at" TIMESTAMP(3),
    "last_sync_error" TEXT,
    "last_lead_at" TIMESTAMP(3),
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "broker_meta_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broker_meta_forms" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "form_id" TEXT NOT NULL,
    "form_name" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sync_cursor" TIMESTAMP(3),
    "last_polled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "broker_meta_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personal_leads" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "broker_id" TEXT NOT NULL,
    "connection_id" TEXT,
    "source_type" TEXT NOT NULL DEFAULT 'BROKER_PERSONAL_META',
    "meta_lead_id" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "platform" TEXT,
    "page_id" TEXT,
    "ad_account_id" TEXT,
    "campaign_id" TEXT,
    "campaign_name" TEXT,
    "adset_id" TEXT,
    "adset_name" TEXT,
    "ad_id" TEXT,
    "ad_name" TEXT,
    "form_id" TEXT,
    "form_name" TEXT,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "raw_data" JSONB NOT NULL DEFAULT '{}',
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "remarketing_notify_at" TIMESTAMP(3),
    "first_contact_at" TIMESTAMP(3),
    "converted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "personal_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personal_lead_notes" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "personal_lead_id" TEXT NOT NULL,
    "author_user_id" TEXT,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "personal_lead_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personal_lead_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "personal_lead_id" TEXT NOT NULL,
    "user_id" TEXT,
    "type" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "personal_lead_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broker_meta_sync_logs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'worker',
    "leads_found" INTEGER NOT NULL DEFAULT 0,
    "leads_created" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broker_meta_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "broker_personal_access_broker_id_key" ON "broker_personal_access"("broker_id");

-- CreateIndex
CREATE INDEX "broker_personal_access_organization_id_idx" ON "broker_personal_access"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "broker_meta_connections_page_id_key" ON "broker_meta_connections"("page_id");

-- CreateIndex
CREATE INDEX "broker_meta_connections_organization_id_broker_id_idx" ON "broker_meta_connections"("organization_id", "broker_id");

-- CreateIndex
CREATE INDEX "broker_meta_connections_is_active_status_idx" ON "broker_meta_connections"("is_active", "status");

-- CreateIndex
CREATE INDEX "broker_meta_forms_organization_id_idx" ON "broker_meta_forms"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "broker_meta_forms_connection_id_form_id_key" ON "broker_meta_forms"("connection_id", "form_id");

-- CreateIndex
CREATE INDEX "personal_leads_organization_id_broker_id_status_idx" ON "personal_leads"("organization_id", "broker_id", "status");

-- CreateIndex
CREATE INDEX "personal_leads_organization_id_broker_id_created_at_idx" ON "personal_leads"("organization_id", "broker_id", "created_at");

-- CreateIndex
CREATE INDEX "personal_leads_status_remarketing_notify_at_idx" ON "personal_leads"("status", "remarketing_notify_at");

-- CreateIndex
CREATE UNIQUE INDEX "personal_leads_organization_id_meta_lead_id_key" ON "personal_leads"("organization_id", "meta_lead_id");

-- CreateIndex
CREATE INDEX "personal_lead_notes_personal_lead_id_created_at_idx" ON "personal_lead_notes"("personal_lead_id", "created_at");

-- CreateIndex
CREATE INDEX "personal_lead_notes_organization_id_idx" ON "personal_lead_notes"("organization_id");

-- CreateIndex
CREATE INDEX "personal_lead_events_personal_lead_id_created_at_idx" ON "personal_lead_events"("personal_lead_id", "created_at");

-- CreateIndex
CREATE INDEX "personal_lead_events_organization_id_idx" ON "personal_lead_events"("organization_id");

-- CreateIndex
CREATE INDEX "broker_meta_sync_logs_connection_id_created_at_idx" ON "broker_meta_sync_logs"("connection_id", "created_at");

-- CreateIndex
CREATE INDEX "broker_meta_sync_logs_organization_id_idx" ON "broker_meta_sync_logs"("organization_id");

-- AddForeignKey
ALTER TABLE "broker_personal_access" ADD CONSTRAINT "broker_personal_access_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broker_personal_access" ADD CONSTRAINT "broker_personal_access_broker_id_fkey" FOREIGN KEY ("broker_id") REFERENCES "brokers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broker_meta_connections" ADD CONSTRAINT "broker_meta_connections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broker_meta_connections" ADD CONSTRAINT "broker_meta_connections_broker_id_fkey" FOREIGN KEY ("broker_id") REFERENCES "brokers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broker_meta_forms" ADD CONSTRAINT "broker_meta_forms_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broker_meta_forms" ADD CONSTRAINT "broker_meta_forms_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "broker_meta_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_leads" ADD CONSTRAINT "personal_leads_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_leads" ADD CONSTRAINT "personal_leads_broker_id_fkey" FOREIGN KEY ("broker_id") REFERENCES "brokers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_leads" ADD CONSTRAINT "personal_leads_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "broker_meta_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_lead_notes" ADD CONSTRAINT "personal_lead_notes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_lead_notes" ADD CONSTRAINT "personal_lead_notes_personal_lead_id_fkey" FOREIGN KEY ("personal_lead_id") REFERENCES "personal_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_lead_notes" ADD CONSTRAINT "personal_lead_notes_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_lead_events" ADD CONSTRAINT "personal_lead_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_lead_events" ADD CONSTRAINT "personal_lead_events_personal_lead_id_fkey" FOREIGN KEY ("personal_lead_id") REFERENCES "personal_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_lead_events" ADD CONSTRAINT "personal_lead_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broker_meta_sync_logs" ADD CONSTRAINT "broker_meta_sync_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broker_meta_sync_logs" ADD CONSTRAINT "broker_meta_sync_logs_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "broker_meta_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

