-- Timeline de notas dos leads + lembrete agendado do Remarketing.
-- Só acréscimos: NENHUMA coluna existente é alterada ou removida. Em especial, leads.notes
-- (as anotações atuais de cada lead) continua exatamente como está — a anotação é COPIADA
-- para a timeline como primeira nota, nunca movida.

-- AlterTable
ALTER TABLE "leads" ADD COLUMN "remarketing_notify_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "lead_notes" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "author_user_id" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'NOTE',
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "edited_at" TIMESTAMP(3),

    CONSTRAINT "lead_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_note_revisions" (
    "id" TEXT NOT NULL,
    "note_id" TEXT NOT NULL,
    "previous_content" TEXT NOT NULL,
    "new_content" TEXT NOT NULL,
    "edited_by_user_id" TEXT,
    "edited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_note_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_notes_lead_id_created_at_idx" ON "lead_notes"("lead_id", "created_at");

-- CreateIndex
CREATE INDEX "lead_notes_organization_id_idx" ON "lead_notes"("organization_id");

-- CreateIndex
CREATE INDEX "lead_note_revisions_note_id_edited_at_idx" ON "lead_note_revisions"("note_id", "edited_at");

-- CreateIndex
CREATE INDEX "leads_status_remarketing_notify_at_idx" ON "leads"("status", "remarketing_notify_at");

-- AddForeignKey
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_note_revisions" ADD CONSTRAINT "lead_note_revisions_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "lead_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_note_revisions" ADD CONSTRAINT "lead_note_revisions_edited_by_user_id_fkey" FOREIGN KEY ("edited_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: cada anotação existente vira a primeira nota (kind OBSERVATION) da timeline do lead.
-- Data = última atualização do lead (o sistema antigo não guardava quando a anotação foi
-- escrita); a tela mostra essa data como aproximada. Autor desconhecido (NULL).
INSERT INTO "lead_notes" ("id", "organization_id", "lead_id", "author_user_id", "kind", "content", "created_at", "updated_at")
SELECT 'legacy_' || "id", "organization_id", "id", NULL, 'OBSERVATION', "notes", "updated_at", "updated_at"
FROM "leads"
WHERE "notes" IS NOT NULL AND btrim("notes") <> '';
