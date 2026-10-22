import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const db = new PrismaClient();
db.$executeRawUnsafe(
  readFileSync(join(__dirname, "repair-sequences.sql"), "utf8"),
)
  .then(() =>
    console.log(
      "Secuencias sincronizadas sin borrar registros ni retroceder contadores.",
    ),
  )
  .catch(() => {
    console.error(
      "No se pudieron sincronizar las secuencias. Revisa DATABASE_URL, las migraciones y los permisos del propietario de la base de datos.",
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
