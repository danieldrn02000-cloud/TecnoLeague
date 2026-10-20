-- Los reenvíos conservan el modo de captura con el que se iniciaron.
CREATE TYPE "ModoCapturaOrders" AS ENUM ('automatic', 'automatic_async');
ALTER TABLE "operaciones_cobro"
ADD COLUMN "modo_captura" "ModoCapturaOrders" NOT NULL DEFAULT 'automatic';
