-- El usuario solicitó retirar el mínimo; las existencias actuales se conservan.
ALTER TABLE "productos" DROP COLUMN "stock_minimo";

-- Solo se encolan pedidos nuevos; no se envían correos retroactivos.
CREATE TABLE "correos_pedido" (
  "pedido_id" INTEGER NOT NULL PRIMARY KEY,
  "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "enviado_en" TIMESTAMP(3),
  "intentos" INTEGER NOT NULL DEFAULT 0,
  "proximo_intento" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "primer_intento_en" TIMESTAMP(3),
  "bloqueado_hasta" TIMESTAMP(3),
  "bloqueo_id" TEXT,
  "contenido" JSONB,
  "ultimo_error" TEXT,
  CONSTRAINT "correos_pedido_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedidos"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "correos_pedido_enviado_en_proximo_intento_idx" ON "correos_pedido"("enviado_en", "proximo_intento");
