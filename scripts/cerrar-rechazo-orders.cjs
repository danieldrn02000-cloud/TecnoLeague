// Reparación administrativa de un rechazo inicial comprobado en los logs.
// Nunca usar para un timeout ni para un 402 recibido al reenviar un cobro.
const { loadEnvFile } = require("node:process");
const { join } = require("node:path");
require("reflect-metadata");
try { loadEnvFile(join(__dirname, "../back/.env")); }
catch (error) {
  if (error.code !== "ENOENT") { console.error("No se pudo leer back/.env."); process.exit(1); }
}
const [intentoId, operacionId, confirmacion, ...extra] = process.argv.slice(2);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!uuid.test(intentoId || "") || !uuid.test(operacionId || "") ||
    confirmacion !== "--confirmar-rechazo-inicial-402" || extra.length) {
  console.error("Uso: npm run checkout:cerrar-rechazo -- INTENTO_ID OPERACION_ID --confirmar-rechazo-inicial-402");
  console.error("Solo si el log original indica http:402, codigo:failed, reenvio:false para esos dos IDs.");
  process.exit(1);
}
const { GraphQLError } = require("graphql");
const { PrismaService } = require("../back/dist/prisma.service");
const { PagosService } = require("../back/dist/pagos.service");
const { EventosService } = require("../back/dist/eventos.service");
const { MercadoPagoOrdersService } = require("../back/dist/mercadopago-orders.service");
const db = new PrismaService();
async function ejecutar() {
  try {
    const pagos = new PagosService(db, new EventosService(), new MercadoPagoOrdersService());
    const estado = await pagos.cerrarRechazoInicial402(intentoId, operacionId);
    console.log(JSON.stringify({ intentoId, estado: estado.estado, estadoOperacion: estado.estadoOperacion }, null, 2));
  } catch (error) {
    console.error(error instanceof GraphQLError ? error.message
      : "No se pudo completar la reparación. Revisa la conexión a la base de datos y el estado del intento.");
    process.exitCode = 1;
  } finally { await db.$disconnect(); }
}
void ejecutar();
