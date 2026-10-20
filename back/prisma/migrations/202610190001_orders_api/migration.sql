-- Conserva los intentos anteriores en el flujo de redirección.
CREATE TYPE "ModalidadCheckout" AS ENUM ('REDIRECCION', 'ORDERS_API');
CREATE TYPE "EstadoOperacionCobro" AS ENUM ('ENVIADA', 'INCIERTA', 'VINCULADA', 'FINALIZADA');

ALTER TABLE "intentos_compra"
ADD COLUMN "modalidad" "ModalidadCheckout" NOT NULL DEFAULT 'REDIRECCION';

CREATE TABLE "operaciones_cobro" (
    "id" TEXT NOT NULL,
    "intento_id" TEXT NOT NULL,
    "clave_solicitud" TEXT NOT NULL,
    "clave_idempotencia" TEXT NOT NULL,
    "huella_solicitud" TEXT NOT NULL,
    "id_orden_externa" TEXT,
    "estado" "EstadoOperacionCobro" NOT NULL DEFAULT 'ENVIADA',
    "estado_proveedor" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "operaciones_cobro_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "operaciones_cobro_clave_solicitud_key" ON "operaciones_cobro"("clave_solicitud");
CREATE UNIQUE INDEX "operaciones_cobro_clave_idempotencia_key" ON "operaciones_cobro"("clave_idempotencia");
CREATE UNIQUE INDEX "operaciones_cobro_id_orden_externa_key" ON "operaciones_cobro"("id_orden_externa");
CREATE INDEX "operaciones_cobro_intento_id_creado_en_idx" ON "operaciones_cobro"("intento_id", "creado_en");

ALTER TABLE "operaciones_cobro" ADD CONSTRAINT "operaciones_cobro_intento_id_fkey"
FOREIGN KEY ("intento_id") REFERENCES "intentos_compra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
