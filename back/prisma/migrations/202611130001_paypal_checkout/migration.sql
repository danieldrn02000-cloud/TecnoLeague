ALTER TYPE "ModalidadCheckout" ADD VALUE 'PAYPAL';
ALTER TABLE "intentos_compra" ADD COLUMN "paypal_captura_iniciada_en" TIMESTAMP(3);
