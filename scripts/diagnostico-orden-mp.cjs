// Consulta de solo lectura: no crea órdenes ni modifica la base de datos.
const { loadEnvFile } = require("node:process");
const { join } = require("node:path");
require("reflect-metadata");
try {
  loadEnvFile(join(__dirname, "../back/.env"));
} catch (error) {
  if (error.code !== "ENOENT") {
    console.error("No se pudo leer back/.env.");
    process.exit(1);
  }
}
const { MercadoPagoOrdersService, ErrorOrdersMP } = require("../back/dist/mercadopago-orders.service");
const id = process.argv[2];
if (!id || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) {
  console.error("Uso: npm run diagnostico:orden -- ID_ORDEN");
  process.exit(1);
}
const codigo = v => typeof v === "string" && /^[A-Za-z0-9_.-]{1,100}$/.test(v) ? v : undefined;
new MercadoPagoOrdersService().consultarOrden(id).then(orden => {
  console.log(JSON.stringify({
    ordenId: id, estado: codigo(orden.status), detalle: codigo(orden.status_detail),
    transacciones: orden.transactions?.payments?.slice(0, 10).map(p => ({
      estado: codigo(p.status), detalle: codigo(p.status_detail),
    })),
  }, null, 2));
}).catch(error => {
  console.error(JSON.stringify(error instanceof ErrorOrdersMP
    ? { http: error.httpProveedor, ...error.diagnostico }
    : { error: "No se pudo consultar la orden. Comprueba MP_ACCESS_TOKEN y la compilación del backend." }));
  process.exitCode = 1;
});
