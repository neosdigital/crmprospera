-- Kanban "Remarketing" (novo valor de status) e retorno agendado de leads perdidos para a roleta.
-- Só acréscimos: nenhum dado existente é alterado.
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'REMARKETING';

ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "return_to_rotation_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "leads_status_return_to_rotation_at_idx" ON "leads"("status", "return_to_rotation_at");
