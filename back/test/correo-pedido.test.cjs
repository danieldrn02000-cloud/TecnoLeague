const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
require("reflect-metadata");
const {
  contenidoPedido,
  CorreoPedidoService,
} = require("../dist/correo-pedido.service");
const { TiendaService } = require("../dist/tienda.service");
const { EventosService } = require("../dist/eventos.service");

test("el correo incluye el folio real, productos, total y entrega sin inventar una guía", () => {
  const body = contenidoPedido(
    {
      id: 7,
      fecha: new Date("2026-11-17T12:00:00Z"),
      nombre: "Cliente <script>alert(1)</script>",
      email: "cliente@example.test",
      direccion: "Calle Uno 123, Guadalajara",
      total: 250,
      metodoPago: "PAYPAL",
      trackingNumber: null,
      trackingCarrierName: null,
      detalles: [
        { cantidad: 2, nombreProducto: "Teclado", precioUnitario: 125 },
      ],
    },
    "TecnoLeague <compras@example.test>",
  );
  assert.deepEqual(body.to, ["cliente@example.test"]);
  assert.match(body.subject, /TL-2026-0007/);
  assert.match(body.text, /2 × Teclado/);
  assert.match(body.text, /250\.00/);
  assert.match(body.text, /Calle Uno 123/);
  assert.match(body.text, /PayPal/);
  assert.ok(!body.html.includes("<script>"));
  assert.match(body.html, /&lt;script&gt;/);
});

test(
  "correos de pedidos: cola transaccional, reintento estable y exclusión concurrente",
  { skip: !process.env.AUTH_TEST_DATABASE_URL },
  async (t) => {
    const { PrismaClient } = require(
      process.env.AUTH_TEST_PRISMA_CLIENT || "@prisma/client",
    );
    const db = new PrismaClient(
      process.env.AUTH_TEST_ADAPTER
        ? {
            adapter: new (require(process.env.AUTH_TEST_ADAPTER).PrismaPg)({
              connectionString: process.env.AUTH_TEST_DATABASE_URL,
            }),
          }
        : { datasources: { db: { url: process.env.AUTH_TEST_DATABASE_URL } } },
    );
    const originales = Object.fromEntries(
      ["RESEND_API_KEY", "PASSWORD_RESET_FROM", "ORDER_EMAIL_FROM"].map((k) => [
        k,
        process.env[k],
      ]),
    );
    Object.assign(process.env, {
      RESEND_API_KEY: "resend-prueba",
      PASSWORD_RESET_FROM: "TecnoLeague <compras@example.test>",
      ORDER_EMAIL_FROM: "",
    });
    const usuario = await db.usuario.create({
      data: {
        nombre: "Cliente correo",
        email: `correo-${randomUUID()}@example.test`,
      },
    });
    const categoria = await db.categoria.create({
      data: { nombre: `Correo-${randomUUID()}` },
    });
    const producto = await db.producto.create({
      data: {
        nombre: "Producto correo",
        descripcion: "Prueba",
        marca: "Test",
        especificaciones: "Prueba",
        imagen: "/images/test.png",
        precio: 125,
        stock: 10,
        categoriaId: categoria.id,
      },
    });
    t.after(async () => {
      const pedidos = await db.pedido.findMany({
        where: { usuarioId: usuario.id },
        select: { id: true },
      });
      const ids = pedidos.map((p) => p.id);
      await db.eventoEstadoPedido.deleteMany({
        where: { pedidoId: { in: ids } },
      });
      await db.movimientoInventario.deleteMany({
        where: { productoId: producto.id },
      });
      await db.detallePedido.deleteMany({ where: { pedidoId: { in: ids } } });
      await db.pedido.deleteMany({ where: { usuarioId: usuario.id } });
      await db.producto.delete({ where: { id: producto.id } });
      await db.categoria.delete({ where: { id: categoria.id } });
      await db.usuario.delete({ where: { id: usuario.id } });
      await db.$disconnect();
      for (const [k, v] of Object.entries(originales)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });
    const tienda = new TiendaService(db, new EventosService());
    const datos = () => ({
      nombre: "Cliente correo",
      email: usuario.email,
      direccion: "Calle Uno 123, Guadalajara",
      claveSolicitud: randomUUID(),
      renglones: [{ productoId: producto.id, cantidad: 1 }],
    });
    const worker = new CorreoPedidoService(db);
    const enviados = [];
    let fallar = true;
    t.mock.method(globalThis, "fetch", async (url, options) => {
      assert.equal(url, "https://api.resend.com/emails");
      enviados.push(options);
      if (fallar) throw new Error("respuesta perdida");
      return Response.json({ id: "email-prueba" });
    });
    const input = datos();
    const pedido = await tienda.crearPedido(input, usuario.id);
    assert.equal((await tienda.crearPedido(input, usuario.id)).id, pedido.id);
    assert.equal(
      await db.correoPedido.count({ where: { pedidoId: pedido.id } }),
      1,
    );
    delete process.env.RESEND_API_KEY;
    await worker.procesarPendientes(pedido.id);
    assert.equal(enviados.length, 0);
    assert.equal((await db.correoPedido.findUnique({ where: { pedidoId: pedido.id } })).intentos, 0);
    process.env.RESEND_API_KEY = "resend-prueba";
    await worker.procesarPendientes(pedido.id);
    assert.equal(
      (await db.pedido.findUnique({ where: { id: pedido.id } })).status,
      "PENDIENTE",
    );
    assert.equal(
      (await db.correoPedido.findUnique({ where: { pedidoId: pedido.id } }))
        .enviadoEn,
      null,
    );
    // Cambios posteriores no alteran el payload usado por la clave idempotente.
    await db.pedido.update({
      where: { id: pedido.id },
      data: { nombre: "Nombre corregido" },
    });
    await db.correoPedido.update({
      where: { pedidoId: pedido.id },
      data: { proximoIntento: new Date(0) },
    });
    fallar = false;
    await worker.procesarPendientes(pedido.id);
    assert.equal(enviados[0].body, enviados[1].body);
    assert.equal(enviados[0].headers["Idempotency-Key"], `pedido-confirmacion-${input.claveSolicitud}`);
    assert.equal(
      enviados[0].headers["Idempotency-Key"],
      enviados[1].headers["Idempotency-Key"],
    );
    assert.ok(
      (await db.correoPedido.findUnique({ where: { pedidoId: pedido.id } }))
        .enviadoEn,
    );
    await worker.procesarPendientes(pedido.id);
    assert.equal(enviados.length, 2);

    const segundo = await tienda.crearPedido(datos(), usuario.id);
    const antes = enviados.length;
    await Promise.all([
      worker.procesarPendientes(segundo.id),
      new CorreoPedidoService(db).procesarPendientes(segundo.id),
    ]);
    assert.equal(enviados.length, antes + 1);
    const tercero = await tienda.crearPedido(datos(), usuario.id);
    await db.correoPedido.update({
      where: { pedidoId: tercero.id },
      data: { primerIntentoEn: new Date(Date.now() - 24 * 3600000) },
    });
    await worker.procesarPendientes(tercero.id);
    assert.equal(
      (await db.correoPedido.findUnique({ where: { pedidoId: tercero.id } }))
        .ultimoError,
      "REVISAR_RESULTADO_ANTERIOR",
    );
    assert.equal(enviados.length, antes + 1);
  },
);
