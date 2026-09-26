-- Registro do resultado de cada aviso de push "sua vez na roleta" (monitoramento de entrega).
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PUSH_SENT';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PUSH_FAILED';
