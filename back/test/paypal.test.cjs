const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
require("reflect-metadata");
const { PayPalService, ErrorPayPal } = require("../dist/paypal.service");
const { PagosService } = require("../dist/pagos.service");

test("PayPal: el adaptador rechaza enlaces ajenos y no confunde aprobación con cobro", t => {
  const anterior = process.env.PAYPAL_ENV; process.env.PAYPAL_ENV = "sandbox";
  t.after(() => { if (anterior === undefined) delete process.env.PAYPAL_ENV; else process.env.PAYPAL_ENV = anterior; });
  const paypal = new PayPalService();
  for (const href of ["https://paypal.example.test/", "https://www.paypal.com/checkoutnow", "javascript:alert(1)", "https://usuario@www.sandbox.paypal.com/"]) {
    assert.throws(() => paypal.urlAprobacion({ id: "ORD1", status: "CREATED", links: [{ rel: "approve", href }] }));
  }
  const unidad = { custom_id: "ref", payee: { merchant_id: "VENDEDOR123" }, amount: { currency_code: "MXN", value: "97.00" } };
  assert.equal(paypal.normalizar({ id: "ORD1", status: "APPROVED", purchase_units: [unidad] }).status, "processing");
  assert.equal(paypal.normalizar({ id: "ORD1", status: "COMPLETED", purchase_units: [{ ...unidad, payments: { captures: [{ id: "CAP1", status: "PENDING", amount: unidad.amount }] } }] }).status, "processing");
  assert.equal(new ErrorPayPal(500).rechazoCreacion, false);
});

test("PayPal Checkout sobre PostgreSQL", { skip: !process.env.PAYPAL_TEST_DATABASE_URL, timeout: 60_000 }, async t => {
  const { PrismaClient } = require(process.env.PAYPAL_TEST_PRISMA_CLIENT || "@prisma/client");
  const db = new PrismaClient(process.env.PAYPAL_TEST_ADAPTER
    ? { adapter: new (require(process.env.PAYPAL_TEST_ADAPTER).PrismaPg)({ connectionString: process.env.PAYPAL_TEST_DATABASE_URL }) }
    : { datasources: { db: { url: process.env.PAYPAL_TEST_DATABASE_URL } } });
  const nombres = ["PAYPAL_ENV", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_MERCHANT_ID", "PAYPAL_RETURN_BASE_URL", "MP_ACCESS_TOKEN", "MP_COLLECTOR_ID"];
  const anteriores = Object.fromEntries(nombres.map(k => [k, process.env[k]]));
  Object.assign(process.env, { PAYPAL_ENV: "sandbox", PAYPAL_CLIENT_ID: "client-prueba", PAYPAL_CLIENT_SECRET: "secret-prueba", PAYPAL_MERCHANT_ID: "VENDEDOR123", PAYPAL_RETURN_BASE_URL: "https://tienda.example.test" });
  delete process.env.MP_ACCESS_TOKEN; delete process.env.MP_COLLECTOR_ID;
  t.after(async () => {
    await db.$disconnect();
    for (const [k,v] of Object.entries(anteriores)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });
  async function fixture(st) {
    const id = randomUUID();
    const usuario = await db.usuario.create({ data: { nombre: "Cliente PayPal", email: `paypal-${id}@example.test` } });
    const categoria = await db.categoria.create({ data: { nombre: `PayPal ${id}` } });
    const productos = [];
    for (const [nombre, precio] of [["Mouse", "10.25"], ["Teclado", "25.50"]]) productos.push(await db.producto.create({ data: {
      nombre, descripcion: "Prueba", precio, stock: 20, imagen: "test.png", categoriaId: categoria.id, marca: "Prueba", especificaciones: "Prueba",
    } }));
    const datos = { claveSolicitud: id, nombre: usuario.nombre, email: usuario.email, direccion: "Calle Prueba 123, Ciudad de México",
      renglones: [{ productoId: productos[0].id, cantidad: 2 }, { productoId: productos[1].id, cantidad: 3 }] };
    const ordenes = new Map(); const solicitudes = []; const clavesCaptura = [];
    const f = { db, usuario, productos, datos, ordenes, solicitudes, clavesCaptura, capturas: 0, creaciones: 0, onCapture: null, onCreate: null };
    const responder = obj => new Response(JSON.stringify(obj));
    st.mock.method(globalThis, "fetch", async (url, options) => {
      solicitudes.push({ url, options });
      if (url.endsWith("/v1/oauth2/token")) return responder({ access_token: "oauth-no-mostrar", expires_in: 300 });
      if (url.endsWith("/v2/checkout/orders") && options.method === "POST") {
        const clave = options.headers["PayPal-Request-Id"];
        let orden = ordenes.get(clave);
        if (!orden) {
          f.creaciones++;
          const body = JSON.parse(options.body);
          const orderId = `ORD${String(f.creaciones).padStart(12,"0")}`;
          orden = { id: orderId, status: "CREATED", purchase_units: body.purchase_units,
            links: [{ rel: "payer-action", href: `https://www.sandbox.paypal.com/checkoutnow?token=${orderId}` }] };
          ordenes.set(clave, orden);
        }
        if (f.onCreate) await f.onCreate(orden);
        return responder(orden);
      }
      const orden = [...ordenes.values()].find(o => url.includes(o.id));
      assert.ok(orden, "Orden externa conocida");
      if (options.method === "POST" && url.endsWith("/capture")) {
        f.capturas++; clavesCaptura.push(options.headers["PayPal-Request-Id"]);
        if (f.onCapture) return f.onCapture(orden, responder);
        completar(orden);
      }
      return responder(orden);
    });
    f.paypal = new PayPalService();
    f.servicio = new PagosService(db, { publicarBackOffice: async () => {} }, {}, f.paypal);
    f.servicio.logger = { log() {}, error() {}, warn() {} };
    f.orden = () => [...ordenes.values()][0];
    st.after(async () => {
      const intentos = await db.intentoCompra.findMany({ where: { usuarioId: usuario.id } }); const ids = intentos.map(i => i.id);
      const pagos = await db.pago.findMany({ where: { intentoId: { in: ids } } });
      const pedidos = intentos.flatMap(i => i.pedidoId ? [i.pedidoId] : []);
      await db.$transaction([
        db.eventoPago.deleteMany({ where: { pagoId: { in: pagos.map(p => p.id) } } }),
        db.movimientoInventario.deleteMany({ where: { usuarioId: usuario.id } }),
        db.eventoEstadoPedido.deleteMany({ where: { pedidoId: { in: pedidos } } }),
        db.detallePedido.deleteMany({ where: { pedidoId: { in: pedidos } } }),
        db.operacionCobro.deleteMany({ where: { intentoId: { in: ids } } }),
        db.detalleIntento.deleteMany({ where: { intentoId: { in: ids } } }),
        db.pago.deleteMany({ where: { intentoId: { in: ids } } }),
        db.intentoCompra.deleteMany({ where: { usuarioId: usuario.id } }),
        db.pedido.deleteMany({ where: { id: { in: pedidos } } }),
        db.usuario.delete({ where: { id: usuario.id } }),
        db.producto.deleteMany({ where: { id: { in: productos.map(p => p.id) } } }),
        db.categoria.delete({ where: { id: categoria.id } }),
      ]);
    });
    return f;
  }
  function completar(orden, status = "COMPLETED") {
    orden.status = "COMPLETED";
    orden.purchase_units[0].payments = { captures: [{ id: "CAPTURA123", status, amount: { ...orden.purchase_units[0].amount, breakdown: undefined } }] };
  }
  await t.test("dos productos: total del servidor, redirección, aprobación y una sola captura/pedido", async st => {
    const f = await fixture(st);
    const intentos = await Promise.all([f.servicio.iniciarPagoPayPal(f.datos, f.usuario.id), f.servicio.iniciarPagoPayPal(f.datos, f.usuario.id)]);
    assert.ok(intentos.some(i => i.checkoutUrl?.startsWith("https://www.sandbox.paypal.com/")));
    assert.equal(f.creaciones, 1); assert.equal(f.capturas, 0);
    const payload = JSON.parse(f.solicitudes.find(s => s.url.endsWith("/v2/checkout/orders")).options.body);
    assert.equal(payload.purchase_units[0].amount.value, "97.00");
    assert.equal(payload.purchase_units[0].items.length, 2);
    assert.equal(payload.purchase_units[0].items[1].quantity, "3");
    assert.match(payload.payment_source.paypal.experience_context.return_url, /resultado=aprobado/);
    f.orden().status = "APPROVED";
    assert.equal((await f.servicio.consultarIntento(f.datos.claveSolicitud, f.usuario.id)).estado, "EN_PROCESO");
    const resultados = await Promise.all([f.servicio.confirmarPagoPayPal(f.datos.claveSolicitud, f.usuario.id), f.servicio.confirmarPagoPayPal(f.datos.claveSolicitud, f.usuario.id)]);
    assert.ok(resultados.some(r => r.estado === "CONFIRMADO"));
    await f.servicio.confirmarPagoPayPal(f.datos.claveSolicitud, f.usuario.id);
    assert.equal(f.capturas, 1);
    const pedido = await db.pedido.findFirstOrThrow({ where: { usuarioId: f.usuario.id }, include: { detalles: true, pagos: true } });
    assert.equal(pedido.metodoPago, "PAYPAL"); assert.equal(pedido.detalles.length, 2); assert.equal(pedido.total.toFixed(2), "97.00");
    assert.equal((await db.producto.findUniqueOrThrow({ where: { id: f.productos[0].id } })).stock, 18);
    assert.equal((await db.producto.findUniqueOrThrow({ where: { id: f.productos[1].id } })).stock, 17);
    assert.equal(await db.pedido.count({ where: { usuarioId: f.usuario.id } }), 1);
  });
  await t.test("compra de un solo producto acredita su importe y conserva los demás", async st => {
    const f = await fixture(st); f.datos.renglones = f.datos.renglones.slice(0, 1);
    const inicio = await f.servicio.iniciarPagoPayPal(f.datos, f.usuario.id);
    assert.equal(inicio.total, "20.50"); f.orden().status = "APPROVED";
    assert.equal((await f.servicio.confirmarPagoPayPal(f.datos.claveSolicitud, f.usuario.id)).estado, "CONFIRMADO");
    assert.equal((await db.producto.findUniqueOrThrow({ where: { id: f.productos[1].id } })).stock, 20);
  });
  await t.test("una URL de regreso simulada sin aprobación no inicia la captura", async st => {
    const f = await fixture(st); await f.servicio.iniciarPagoPayPal(f.datos, f.usuario.id);
    assert.equal((await f.servicio.confirmarPagoPayPal(f.datos.claveSolicitud, f.usuario.id)).estado, "EN_PROCESO");
    assert.equal(f.capturas, 0); assert.equal(await db.pedido.count({ where: { usuarioId: f.usuario.id } }), 0);
  });
  await t.test("cancelación antes del cobro y regreso tardío no capturan ni liberan dos veces", async st => {
    const f = await fixture(st); await f.servicio.iniciarPagoPayPal(f.datos, f.usuario.id);
    f.orden().status = "APPROVED";
    assert.equal((await f.servicio.cancelarIntento(f.datos.claveSolicitud, f.usuario.id)).estado, "CANCELADO");
    await f.servicio.cancelarIntento(f.datos.claveSolicitud, f.usuario.id);
    assert.equal((await f.servicio.confirmarPagoPayPal(f.datos.claveSolicitud, f.usuario.id)).estado, "CANCELADO");
    assert.equal(f.capturas, 0);
    assert.equal((await db.producto.findUniqueOrThrow({ where: { id: f.productos[0].id } })).stock, 20);
  });
  await t.test("reserva vencida sin captura se libera y no puede cobrarse", async st => {
    const f = await fixture(st); await f.servicio.iniciarPagoPayPal(f.datos, f.usuario.id);
    f.orden().status = "APPROVED";
    await db.intentoCompra.update({ where: { id: f.datos.claveSolicitud }, data: { expiraEn: new Date(0) } });
    assert.equal((await f.servicio.confirmarPagoPayPal(f.datos.claveSolicitud, f.usuario.id)).estado, "EXPIRADO");
    assert.equal(f.capturas, 0);
  });
  await t.test("creación con respuesta perdida conserva el mismo payload y clave", async st => {
    const f = await fixture(st); let primera = true;
    f.onCreate = async () => { if (primera) { primera = false; throw new Error("timeout"); } };
    const resultado = await f.servicio.iniciarPagoPayPal(f.datos, f.usuario.id);
    assert.ok(resultado.checkoutUrl); assert.equal(f.creaciones, 1);
    const posts = f.solicitudes.filter(s => s.url.endsWith("/v2/checkout/orders"));
    assert.equal(posts.length, 2); assert.equal(posts[0].options.body, posts[1].options.body);
    assert.equal(posts[0].options.headers["PayPal-Request-Id"], posts[1].options.headers["PayPal-Request-Id"]);
  });
  await t.test("captura completada con respuesta perdida se recupera sin otro cobro", async st => {
    const f = await fixture(st); await f.servicio.iniciarPagoPayPal(f.datos, f.usuario.id); f.orden().status = "APPROVED";
    f.onCapture = async orden => { completar(orden); throw new Error("respuesta perdida"); };
    assert.equal((await f.servicio.confirmarPagoPayPal(f.datos.claveSolicitud, f.usuario.id)).estado, "CONFIRMADO");
    assert.equal(f.capturas, 1);
  });
  await t.test("captura incierta conserva inventario; reenvío usa la misma clave", async st => {
    const f = await fixture(st); await f.servicio.iniciarPagoPayPal(f.datos, f.usuario.id); f.orden().status = "APPROVED";
    f.onCapture = async () => new Response("error privado", { status: 500 });
    assert.equal((await f.servicio.confirmarPagoPayPal(f.datos.claveSolicitud, f.usuario.id)).estado, "EN_PROCESO");
    assert.equal((await f.servicio.cancelarIntento(f.datos.claveSolicitud, f.usuario.id)).estado, "EN_PROCESO");
    assert.equal((await db.producto.findUniqueOrThrow({ where: { id: f.productos[0].id } })).stock, 18);
    await db.intentoCompra.update({ where: { id: f.datos.claveSolicitud }, data: { paypalCapturaIniciadaEn: new Date(Date.now()-31_000) } });
    f.onCapture = null;
    assert.equal((await f.servicio.confirmarPagoPayPal(f.datos.claveSolicitud, f.usuario.id)).estado, "CONFIRMADO");
    assert.equal(f.clavesCaptura[0], f.clavesCaptura[1]);
  });
  await t.test("una captura pendiente no acredita; al completarse sí confirma", async st => {
    const f = await fixture(st); await f.servicio.iniciarPagoPayPal(f.datos, f.usuario.id); f.orden().status = "APPROVED";
    f.onCapture = async (orden, responder) => { completar(orden, "PENDING"); return responder(orden); };
    assert.equal((await f.servicio.confirmarPagoPayPal(f.datos.claveSolicitud, f.usuario.id)).estado, "EN_PROCESO");
    assert.equal(await db.pedido.count({ where: { usuarioId: f.usuario.id } }), 0);
    completar(f.orden());
    assert.equal((await f.servicio.consultarIntento(f.datos.claveSolicitud, f.usuario.id)).estado, "CONFIRMADO");
  });
  await t.test("rechazo de instrumento en la primera captura termina y libera inventario", async st => {
    const f = await fixture(st); await f.servicio.iniciarPagoPayPal(f.datos, f.usuario.id); f.orden().status = "APPROVED";
    f.onCapture = async () => new Response(JSON.stringify({ details: [{ issue: "INSTRUMENT_DECLINED" }] }), { status: 422 });
    assert.equal((await f.servicio.confirmarPagoPayPal(f.datos.claveSolicitud, f.usuario.id)).estado, "RECHAZADO");
    assert.equal((await db.producto.findUniqueOrThrow({ where: { id: f.productos[0].id } })).stock, 20);
  });
  await t.test("cancelar durante una captura en curso conserva la reserva hasta conocer el resultado", async st => {
    const f = await fixture(st); await f.servicio.iniciarPagoPayPal(f.datos, f.usuario.id); f.orden().status = "APPROVED";
    let entrar, continuar;
    const dentro = new Promise(r => { entrar = r; }); const espera = new Promise(r => { continuar = r; });
    f.onCapture = async (orden, responder) => { entrar(); await espera; completar(orden); return responder(orden); };
    const pago = f.servicio.confirmarPagoPayPal(f.datos.claveSolicitud, f.usuario.id);
    await dentro;
    try {
      assert.equal((await f.servicio.cancelarIntento(f.datos.claveSolicitud, f.usuario.id)).estado, "EN_PROCESO");
      assert.equal((await db.producto.findUniqueOrThrow({ where: { id: f.productos[0].id } })).stock, 18);
    } finally { continuar(); }
    assert.equal((await pago).estado, "CONFIRMADO"); assert.equal(f.capturas, 1);
  });
  await t.test("una respuesta tardía de creación no reabre la compra cancelada", async st => {
    const f = await fixture(st); let entrar, continuar;
    const dentro = new Promise(r => { entrar = r; }); const espera = new Promise(r => { continuar = r; });
    f.onCreate = async () => { entrar(); await espera; };
    const creacion = f.servicio.iniciarPagoPayPal(f.datos, f.usuario.id);
    await dentro;
    try { assert.equal((await f.servicio.cancelarIntento(f.datos.claveSolicitud, f.usuario.id)).estado, "CANCELADO"); }
    finally { continuar(); }
    assert.equal((await creacion).estado, "CANCELADO"); f.orden().status = "APPROVED";
    assert.equal((await f.servicio.confirmarPagoPayPal(f.datos.claveSolicitud, f.usuario.id)).estado, "CANCELADO");
    assert.equal(f.capturas, 0);
    assert.equal((await db.producto.findUniqueOrThrow({ where: { id: f.productos[0].id } })).stock, 20);
  });
  await t.test("una captura con importe distinto al total no crea un pedido pagado", async st => {
    const f = await fixture(st); await f.servicio.iniciarPagoPayPal(f.datos, f.usuario.id); f.orden().status = "APPROVED";
    f.onCapture = async (orden, responder) => { completar(orden); orden.purchase_units[0].payments.captures[0].amount.value = "1.00"; return responder(orden); };
    assert.equal((await f.servicio.confirmarPagoPayPal(f.datos.claveSolicitud, f.usuario.id)).estado, "EN_PROCESO");
    assert.equal(await db.pedido.count({ where: { usuarioId: f.usuario.id } }), 0);
  });
  await t.test("usuario ajeno, vendedor, referencia o importes alterados nunca capturan", async st => {
    const f = await fixture(st); await f.servicio.iniciarPagoPayPal(f.datos, f.usuario.id); f.orden().status = "APPROVED";
    await assert.rejects(f.servicio.confirmarPagoPayPal(f.datos.claveSolicitud, f.usuario.id+10000), /no encontrada/);
    const unidad = f.orden().purchase_units[0];
    for (const [objeto, clave, malo] of [[unidad.payee, "merchant_id", "OTROVENDEDOR"], [unidad, "custom_id", "OTRAREF"], [unidad.amount, "value", "1.00"], [unidad.amount, "currency_code", "USD"]]) {
      const antes = objeto[clave]; objeto[clave] = malo;
      await assert.rejects(f.servicio.confirmarPagoPayPal(f.datos.claveSolicitud, f.usuario.id), /no coincide/);
      objeto[clave] = antes;
    }
    assert.equal(f.capturas, 0);
  });
});
