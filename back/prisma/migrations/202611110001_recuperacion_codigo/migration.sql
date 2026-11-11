ALTER TABLE "usuarios" ADD COLUMN "version_sesion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "tokens_recuperacion"
  ALTER COLUMN "usuario_id" DROP NOT NULL,
  ADD COLUMN "email" TEXT,
  ADD COLUMN "codigo_hash" TEXT,
  ADD COLUMN "intentos" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "verificado_en" TIMESTAMP(3);
CREATE INDEX "tokens_recuperacion_email_creado_en_idx" ON "tokens_recuperacion"("email", "creado_en");
-- Los enlaces anteriores se sustituyen por códigos verificados de un solo uso.
UPDATE "tokens_recuperacion" SET "usado_en" = CURRENT_TIMESTAMP WHERE "usado_en" IS NULL;
