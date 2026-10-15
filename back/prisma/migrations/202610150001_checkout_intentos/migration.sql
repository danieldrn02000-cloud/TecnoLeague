-- CreateEnum
CREATE TYPE "EstadoIntento" AS ENUM ('INICIADO', 'EN_PROCESO', 'CONFIRMADO', 'RECHAZADO', 'CANCELADO', 'EXPIRADO');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TipoMovimientoInventario" ADD VALUE 'RESERVA';
ALTER TYPE "TipoMovimientoInventario" ADD VALUE 'LIBERACION';

-- AlterTable
ALTER TABLE "pagos" ADD COLUMN     "intento_id" TEXT,
ALTER COLUMN "pedido_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "intentos_compra" (
    "id" TEXT NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "clave_solicitud" TEXT NOT NULL,
    "huella_solicitud" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "direccion" TEXT NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "moneda" TEXT NOT NULL DEFAULT 'MXN',
    "estado" "EstadoIntento" NOT NULL DEFAULT 'INICIADO',
    "pedido_id" INTEGER,
    "checkout_payload" JSONB,
    "checkout_url" TEXT,
    "reserva_activa" BOOLEAN NOT NULL DEFAULT true,
    "expira_en" TIMESTAMP(3) NOT NULL,
    "proxima_revision" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimo_error" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intentos_compra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "detalle_intento" (
    "id" SERIAL NOT NULL,
    "intento_id" TEXT NOT NULL,
    "producto_id" INTEGER NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "precio_unitario" DECIMAL(10,2) NOT NULL,
    "nombre_producto" TEXT NOT NULL,

    CONSTRAINT "detalle_intento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "intentos_compra_clave_solicitud_key" ON "intentos_compra"("clave_solicitud");

-- CreateIndex
CREATE UNIQUE INDEX "intentos_compra_pedido_id_key" ON "intentos_compra"("pedido_id");

-- CreateIndex
CREATE INDEX "intentos_compra_estado_proxima_revision_idx" ON "intentos_compra"("estado", "proxima_revision");

-- CreateIndex
CREATE INDEX "intentos_compra_usuario_id_creado_en_idx" ON "intentos_compra"("usuario_id", "creado_en");

-- CreateIndex
CREATE UNIQUE INDEX "detalle_intento_intento_id_producto_id_key" ON "detalle_intento"("intento_id", "producto_id");

-- CreateIndex
CREATE UNIQUE INDEX "pagos_intento_id_key" ON "pagos"("intento_id");

-- AddForeignKey
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_intento_id_fkey" FOREIGN KEY ("intento_id") REFERENCES "intentos_compra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intentos_compra" ADD CONSTRAINT "intentos_compra_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intentos_compra" ADD CONSTRAINT "intentos_compra_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedidos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detalle_intento" ADD CONSTRAINT "detalle_intento_intento_id_fkey" FOREIGN KEY ("intento_id") REFERENCES "intentos_compra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detalle_intento" ADD CONSTRAINT "detalle_intento_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

