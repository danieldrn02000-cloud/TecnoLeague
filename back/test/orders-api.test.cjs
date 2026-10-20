const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { buildSchema, graphql } = require("graphql");
require("reflect-metadata");
const { PagosService } = require("../dist/pagos.service");
const { PagosResolver } = require("../dist/pagos.resolver");
const { MercadoPagoOrdersService, ErrorOrdersMP } = require("../dist/mercadopago-orders.service");

test("Orders HTTP: payload automático, idempotencia y respuesta sin token", async (t) => {
  const anterior = process.env.MP_ACCESS_TOKEN;
  process.env.MP_ACCESS_TOKEN = "token-simulado";
  t.after(() => {
    if (anterior === undefined) delete process.env.MP_ACCESS_TOKEN;
    else process.env.MP_ACCESS_TOKEN = anterior;
  });
  const solicitudes = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    solicitudes.push({ url, options });
    return new Response(JSON.stringify({
      id: "ORD1", status: "processed", status_detail: "accredited",
      total_amount: "25.50", total_paid_amount: "25.50",
      transactions: { payments: [{ payment_method: { token: "no-devolver" } }] },
    }));
  });
  const resultado = await new MercadoPagoOrdersService().crearYProcesarOrden({
    total: "25.50", referenciaExterna: "TL-OP-test", claveIdempotencia: "clave-unica",
    token: "token-tarjeta-simulado", metodoPagoId: "visa", tipoMetodoPago: "credit_card",
    cuotas: 1, email: "comprador@example.test",
  });
  assert.equal(solicitudes.length, 1);
  assert.equal(solicitudes[0].url, "https://api.mercadopago.com/v1/orders");
  const { options } = solicitudes[0];
  assert.equal(options.headers["X-Idempotency-Key"], "clave-unica");
  const body = JSON.parse(options.body);
  assert.equal(body.processing_mode, "automatic");
  assert.equal(body.capture_mode, "automatic");
  assert.equal(body.currency, "MXN");
  assert.equal(body.transactions.payments[0].amount, "25.50");
  assert.equal(body.transactions.payments[0].payment_method.token, "token-tarjeta-simulado");
  assert.equal(body.config, undefined);
  assert.equal(JSON.stringify(resultado).includes("no-devolver"), false);
});

test("Orders HTTP: timeout, 409 y 5xx son inciertos; errores no filtran el cuerpo", async (t) => {
  const anterior = process.env.MP_ACCESS_TOKEN;
  process.env.MP_ACCESS_TOKEN = "token-simulado";
  t.after(() => {
    if (anterior === undefined) delete process.env.MP_ACCESS_TOKEN;
    else process.env.MP_ACCESS_TOKEN = anterior;
  });
  const servicio = new MercadoPagoOrdersService();
  const mocked = t.mock.method(globalThis, "fetch", async () => { throw new Error("secreto"); });
  await assert.rejects(servicio.consultarOrden("ORD1"), (e) => e instanceof ErrorOrdersMP && !e.rechazadoDefinitivo && !e.message.includes("secreto"));
  for (const status of [400, 401, 403, 409, 422, 429, 500]) {
    mocked.mock.mockImplementation(async () => new Response("secreto", { status }));
    await assert.rejects(servicio.consultarOrden("ORD1"), (e) =>
      e instanceof ErrorOrdersMP && e.httpProveedor === status &&
      e.rechazadoDefinitivo === [400, 401, 403, 422].includes(status) && !e.message.includes("secreto"));
  }
});

test("Resolver: las nuevas mutaciones usan el usuario autenticado", async () => {
  const llamadas = [];
  const resolver = new PagosResolver({
    prepararCompra: (...args) => llamadas.push(args),
    procesarPago: (...args) => llamadas.push(args),
  }, { usuarioActual: async () => ({ id: 7 }) });
  await resolver.prepararCompra({ nombre: "test" }, {});
  await resolver.procesarPago("intento", { token: "test" }, {});
  assert.equal(llamadas[0][1], 7);
  assert.equal(llamadas[1][2], 7);
});

test("Orders HTTP: el diagnóstico conserva códigos y descarta datos sensibles", async (t) => {
  const anterior = process.env.MP_ACCESS_TOKEN;
  process.env.MP_ACCESS_TOKEN = "token-simulado";
  t.after(() => {
    if (anterior === undefined) delete process.env.MP_ACCESS_TOKEN;
    else process.env.MP_ACCESS_TOKEN = anterior;
  });
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    error: "bad_request", message: "token y correo secreto@example.test",
    cause: [{ code: "invalid_properties", message: "dato-sensible" }, { code: "correo@privado.test" }],
  }), { status: 400, headers: { "x-request-id": "request-123" } }));
  await assert.rejects(new MercadoPagoOrdersService().consultarOrden("ORD1"), error => {
    assert.deepEqual(error.diagnostico, { codigo: "bad_request", causas: ["invalid_properties"], campos: [], formato: "cause", requestId: "request-123" });
    assert.ok(!JSON.stringify(error).includes("secreto@example.test"));
    assert.ok(!JSON.stringify(error).includes("dato-sensible"));
    return true;
  });
});

test("Orders HTTP: interpreta errors y rutas del campo sin exponer mensajes ni valores", async (t) => {
  const anterior = process.env.MP_ACCESS_TOKEN;
  process.env.MP_ACCESS_TOKEN = "token-simulado";
  t.after(() => {
    if (anterior === undefined) delete process.env.MP_ACCESS_TOKEN;
    else process.env.MP_ACCESS_TOKEN = anterior;
  });
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    errors: [{ code: "unsupported_properties", message: "Invalid property capture_mode: secreto@example.test token-privado", details: ["capture_mode", "currency", "secreto@example.test"] },
      { code: "invalid_properties", details: [{ path: "/transactions/payments/0/payment_method/type", value: "token-privado" }] }],
  }), { status: 400 }));
  await assert.rejects(new MercadoPagoOrdersService().consultarOrden("ORD1"), error => {
    assert.equal(error.diagnostico.codigo, "unsupported_properties");
    assert.deepEqual(error.diagnostico.causas, ["unsupported_properties", "invalid_properties"]);
    assert.deepEqual(error.diagnostico.campos, ["capture_mode", "currency", "transactions.payments[0].payment_method.type"]);
    assert.equal(error.diagnostico.formato, "errors");
    assert.ok(!JSON.stringify(error).includes("secreto@example.test"));
    assert.ok(!JSON.stringify(error).includes("token-privado"));
    return true;
  });
});

test("Orders HTTP: captura asíncrona conserva solo la acción 3DS", async (t) => {
  const anterior = process.env.MP_ACCESS_TOKEN;
  process.env.MP_ACCESS_TOKEN = "token-simulado";
  t.after(() => {
    if (anterior === undefined) delete process.env.MP_ACCESS_TOKEN;
    else process.env.MP_ACCESS_TOKEN = anterior;
  });
  let payload;
  t.mock.method(globalThis, "fetch", async (_, options) => {
    payload = JSON.parse(options.body);
    return new Response(JSON.stringify({
      id: "ORD-3DS", status: "action_required", transactions: { payments: [{
        payment_method: { token: "no-devolver", transaction_security: {
          type: "challenge", status: "pending", url: "https://banco.example.test/challenge",
        } },
      }] },
    }));
  });
  const orden = await new MercadoPagoOrdersService().crearYProcesarOrden({
    modoCaptura: "automatic_async", total: "51.00", referenciaExterna: "ref",
    claveIdempotencia: "key", email: "test@example.test", token: "token",
    metodoPagoId: "visa", tipoMetodoPago: "credit_card", cuotas: 1,
  });
  assert.equal(payload.capture_mode, "automatic_async");
  // Orders recibe la configuración 3DS en config.online; el endpoint rechaza
  // transaction_security dentro del método de pago con unsupported_properties.
  assert.deepEqual(payload.transactions.payments[0].payment_method, {
    id: "visa", type: "credit_card", token: "token", installments: 1,
  });
  assert.deepEqual(payload.config, {
    online: { transaction_security: { validation: "on_fraud_risk" } },
  });
  assert.equal(orden.transactions.payments[0].payment_method.transaction_security.url, "https://banco.example.test/challenge");
  assert.equal(JSON.stringify(orden).includes("no-devolver"), false);
});

test("Orders y reservas sobre PostgreSQL real", {
  skip: !process.env.ORDERS_TEST_DATABASE_URL,
  timeout: 60_000,
}, async (t) => {
  // Solo se utiliza la URL explícita de pruebas; nunca DATABASE_URL por defecto.
  const { PrismaClient } = require(process.env.ORDERS_TEST_PRISMA_CLIENT || "@prisma/client");
  const url = process.env.ORDERS_TEST_DATABASE_URL;
  const opciones = process.env.ORDERS_TEST_ADAPTER
    ? { adapter: new (require(process.env.ORDERS_TEST_ADAPTER).PrismaPg)({ connectionString: url }) }
    : { datasources: { db: { url } } };
  const db = new PrismaClient(opciones);
  await db.$connect();
  t.after(() => db.$disconnect());
  const originales = Object.fromEntries(["MP_ACCESS_TOKEN", "MP_COLLECTOR_ID", "MP_WEBHOOK_SECRET"].map(k => [k, process.env[k]]));
  process.env.MP_ACCESS_TOKEN = "token-simulado";
  process.env.MP_COLLECTOR_ID = "123";
  process.env.MP_WEBHOOK_SECRET = "firma-simulada";
  t.after(() => {
    for (const [k, v] of Object.entries(originales)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
  const schema = buildSchema(readFileSync(join(__dirname, "../src/schema.graphql"), "utf8"));

  async function fixture(st) {
    const marca = randomUUID();
    const categoria = await db.categoria.create({ data: { nombre: `orders-test-${marca}` } });
    const usuario = await db.usuario.create({ data: { nombre: "Prueba Orders", email: `${marca}@example.test` } });
    const producto = await db.producto.create({ data: {
      nombre: "Producto test", descripcion: "test", precio: "25.50", stock: 10,
      imagen: "test", marca: "test", especificaciones: "test", categoriaId: categoria.id,
    } });
    st.after(async () => {
      const intentos = await db.intentoCompra.findMany({ where: { usuarioId: usuario.id }, include: { pago: true } });
      const ids = intentos.map(i => i.id);
      const pedidos = intentos.flatMap(i => i.pedidoId ? [i.pedidoId] : []);
      await db.$transaction([
        db.eventoPago.deleteMany({ where: { pagoId: { in: intentos.flatMap(i => i.pago ? [i.pago.id] : []) } } }),
        db.eventoEstadoPedido.deleteMany({ where: { pedidoId: { in: pedidos } } }),
        db.movimientoInventario.deleteMany({ where: { usuarioId: usuario.id } }),
        db.detallePedido.deleteMany({ where: { pedidoId: { in: pedidos } } }),
        db.operacionCobro.deleteMany({ where: { intentoId: { in: ids } } }),
        db.detalleIntento.deleteMany({ where: { intentoId: { in: ids } } }),
        db.pago.deleteMany({ where: { intentoId: { in: ids } } }),
        db.intentoCompra.deleteMany({ where: { usuarioId: usuario.id } }),
        db.pedido.deleteMany({ where: { id: { in: pedidos } } }),
        db.usuario.delete({ where: { id: usuario.id } }),
        db.producto.delete({ where: { id: producto.id } }),
        db.categoria.delete({ where: { id: categoria.id } }),
      ]);
    });
    const llamadas = [];
    const ordenes = new Map();
    const proveedor = {
      async crearYProcesarOrden(datos) {
        llamadas.push(datos);
        let orden = ordenes.get(datos.claveIdempotencia);
        if (!orden) {
          orden = {
            id: `ORD-${randomUUID()}`, status: "processed", status_detail: "accredited",
            total_amount: datos.total, total_paid_amount: datos.total,
            external_reference: datos.referenciaExterna, user_id: "123", currency: "MXN",
          };
          ordenes.set(datos.claveIdempotencia, orden);
        }
        return orden;
      },
      async consultarOrden(id) {
        const orden = [...ordenes.values()].find(o => o.id === id);
        assert.ok(orden, `Orden conocida ${id}`);
        return orden;
      },
    };
    const servicio = new PagosService(db, { publicarBackOffice: async () => {} }, proveedor);
    servicio.logger = { log() {}, error() {}, warn() {} };
    const compra = {
      claveSolicitud: randomUUID(), nombre: usuario.nombre, email: usuario.email,
      direccion: "Calle de prueba 123, Ciudad de México",
      renglones: [{ productoId: producto.id, cantidad: 2 }],
    };
    const pago = {
      claveOperacion: randomUUID(), token: "tarjeta-simulada-no-persistir",
      metodoPagoId: "visa", tipoMetodoPago: "credit_card", cuotas: 1, email: usuario.email,
    };
    return { db, usuario, producto, servicio, proveedor, compra, pago, llamadas, ordenes };
  }

  await t.test("GraphQL prepara y consulta sin llamar al proveedor; reserva una sola vez", async (st) => {
    const f = await fixture(st);
    const resolver = new PagosResolver(f.servicio, { usuarioActual: async () => f.usuario });
    const result = await graphql({ schema,
      source: "mutation($datos:PedidoInput!){prepararCompra(datos:$datos){intentoId total moneda modalidad estado estadoOperacion}}",
      variableValues: { datos: f.compra },
      rootValue: { prepararCompra: ({ datos }) => resolver.prepararCompra(datos, {}) },
    });
    assert.equal(result.errors, undefined);
    assert.equal(result.data.prepararCompra.total, "51.00");
    assert.equal(result.data.prepararCompra.modalidad, "ORDERS_API");
    await f.servicio.prepararCompra(f.compra, f.usuario.id);
    await f.servicio.consultarIntento(f.compra.claveSolicitud, f.usuario.id);
    await f.servicio.revisarPendientes();
    assert.equal(f.llamadas.length, 0);
    assert.equal((await db.producto.findUniqueOrThrow({ where: { id: f.producto.id } })).stock, 8);
    assert.equal(await db.pedido.count({ where: { usuarioId: f.usuario.id } }), 0);
  });

  await t.test("doble envío concurrente: un cobro y un pedido con total del servidor", async (st) => {
    const f = await fixture(st);
    const preparado = await f.servicio.prepararCompra(f.compra, f.usuario.id);
    const resultados = await Promise.all([
      f.servicio.procesarPago(preparado.intentoId, f.pago, f.usuario.id),
      f.servicio.procesarPago(preparado.intentoId, { ...f.pago, claveOperacion: randomUUID() }, f.usuario.id),
    ]);
    assert.ok(resultados.some(r => r.estado === "CONFIRMADO"));
    await f.servicio.procesarPago(preparado.intentoId, f.pago, f.usuario.id);
    assert.equal(f.llamadas.length, 1);
    assert.equal(f.llamadas[0].total, "51.00");
    assert.equal(await db.pedido.count({ where: { usuarioId: f.usuario.id } }), 1);
    const op = await db.operacionCobro.findFirstOrThrow({ where: { intentoId: preparado.intentoId } });
    assert.equal(op.estado, "FINALIZADA");
    assert.equal(JSON.stringify(op).includes(f.pago.token), false);
    assert.equal((await db.producto.findUniqueOrThrow({ where: { id: f.producto.id } })).stock, 8);
  });

  await t.test("consultar durante la creación no registra una falsa falla de conexión", async (st) => {
    const f = await fixture(st);
    await f.servicio.prepararCompra(f.compra, f.usuario.id);
    let liberar;
    let iniciado;
    const comienzo = new Promise(resolve => { iniciado = resolve; });
    const espera = new Promise(resolve => { liberar = resolve; });
    const crear = f.proveedor.crearYProcesarOrden;
    const errores = [];
    f.servicio.logger.error = mensaje => errores.push(mensaje);
    f.proveedor.crearYProcesarOrden = async datos => { iniciado(); await espera; return crear(datos); };
    const pago = f.servicio.procesarPago(f.compra.claveSolicitud, f.pago, f.usuario.id);
    await comienzo;
    try {
      const estado = await f.servicio.consultarIntento(f.compra.claveSolicitud, f.usuario.id);
      assert.equal(estado.estado, "EN_PROCESO");
      assert.equal(estado.estadoOperacion, "ENVIADA");
      assert.match(estado.aviso, /esperando la respuesta/);
      assert.equal(errores.length, 0);
    } finally { liberar(); }
    assert.equal((await pago).estado, "CONFIRMADO");
  });

  await t.test("otro usuario, importe cliente y débito con cuotas no se aceptan", async (st) => {
    const f = await fixture(st);
    await f.servicio.prepararCompra(f.compra, f.usuario.id);
    await assert.rejects(f.servicio.procesarPago(f.compra.claveSolicitud, f.pago, f.usuario.id + 1), /no encontrado/);
    await assert.rejects(f.servicio.procesarPago(f.compra.claveSolicitud, { ...f.pago, tipoMetodoPago: "debit_card", cuotas: 2 }, f.usuario.id), /datos de pago/);
    const result = await graphql({ schema,
      source: "mutation($p:DatosPagoInput!){procesarPago(intentoId:\"test\",datosPago:$p){estado}}",
      variableValues: { p: { ...f.pago, total: "0.01" } },
    });
    assert.ok(result.errors);
    assert.equal(f.llamadas.length, 0);
  });

  await t.test("rechazo verificado libera stock una sola vez", async (st) => {
    const f = await fixture(st);
    const eventos = [];
    f.servicio.logger.log = mensaje => eventos.push(JSON.parse(mensaje));
    const crear = f.proveedor.crearYProcesarOrden;
    f.proveedor.crearYProcesarOrden = async datos => {
      const orden = await crear(datos);
      Object.assign(orden, { status: "failed", status_detail: "rejected", total_paid_amount: "0.00" });
      return orden;
    };
    await f.servicio.prepararCompra(f.compra, f.usuario.id);
    const result = await f.servicio.procesarPago(f.compra.claveSolicitud, f.pago, f.usuario.id);
    assert.equal(result.estado, "RECHAZADO");
    assert.equal(result.solicitudRechazada, false);
    assert.ok(eventos.some(e => e.resultado === "ORDEN_MP_VERIFICADA" && e.estado === "failed" && e.detalle === "rejected"));
    await f.servicio.consultarIntento(f.compra.claveSolicitud, f.usuario.id);
    assert.equal((await db.producto.findUniqueOrThrow({ where: { id: f.producto.id } })).stock, 10);
    assert.equal(await db.pedido.count({ where: { usuarioId: f.usuario.id } }), 0);
  });

  await t.test("timeout: no hay nuevo cobro; reenvío idéntico usa la misma idempotencia", async (st) => {
    const f = await fixture(st);
    const crear = f.proveedor.crearYProcesarOrden;
    let perdida = true;
    f.proveedor.crearYProcesarOrden = async datos => {
      const orden = await crear(datos);
      if (perdida) { perdida = false; throw new ErrorOrdersMP(null); }
      return orden;
    };
    await f.servicio.prepararCompra(f.compra, f.usuario.id);
    await assert.rejects(f.servicio.procesarPago(f.compra.claveSolicitud, f.pago, f.usuario.id), /confirmar el cobro/);
    const pendiente = await f.servicio.consultarIntento(f.compra.claveSolicitud, f.usuario.id);
    assert.equal(pendiente.estadoOperacion, "INCIERTA");
    await db.intentoCompra.update({ where: { id: f.compra.claveSolicitud }, data: { expiraEn: new Date(0) } });
    await f.servicio.revisarPendientes();
    await assert.rejects(f.servicio.cancelarIntento(f.compra.claveSolicitud, f.usuario.id));
    assert.equal((await db.producto.findUniqueOrThrow({ where: { id: f.producto.id } })).stock, 8);
    await assert.rejects(f.servicio.procesarPago(f.compra.claveSolicitud, { ...f.pago, token: "otro-token" }, f.usuario.id), /mismos datos/);
    await f.servicio.procesarPago(f.compra.claveSolicitud, { ...f.pago, claveOperacion: randomUUID() }, f.usuario.id);
    assert.equal(f.llamadas.length, 1);
    const result = await f.servicio.procesarPago(f.compra.claveSolicitud, f.pago, f.usuario.id);
    assert.equal(result.estado, "CONFIRMADO");
    assert.equal(f.llamadas.length, 2);
    assert.equal(f.llamadas[0].claveIdempotencia, f.llamadas[1].claveIdempotencia);
    assert.equal(f.ordenes.size, 1);
  });

  await t.test("webhook recupera orden tras timeout y sus duplicados no crean pedidos", async (st) => {
    const f = await fixture(st);
    const crear = f.proveedor.crearYProcesarOrden;
    f.proveedor.crearYProcesarOrden = async datos => { await crear(datos); throw new ErrorOrdersMP(null); };
    await f.servicio.prepararCompra(f.compra, f.usuario.id);
    await assert.rejects(f.servicio.procesarPago(f.compra.claveSolicitud, f.pago, f.usuario.id));
    const orden = [...f.ordenes.values()][0];
    st.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(orden)));
    await f.servicio.procesarWebhook("order", orden.id);
    await f.servicio.procesarWebhook("order", orden.id);
    assert.equal(await db.pedido.count({ where: { usuarioId: f.usuario.id } }), 1);
    assert.equal(f.llamadas.length, 1);
  });

  await t.test("un rechazo HTTP del reenvío no descarta un cobro anterior incierto", async (st) => {
    const f = await fixture(st);
    const crear = f.proveedor.crearYProcesarOrden;
    let primera = true;
    f.proveedor.crearYProcesarOrden = async datos => {
      if (primera) { primera = false; await crear(datos); throw new ErrorOrdersMP(null); }
      throw new ErrorOrdersMP(400);
    };
    await f.servicio.prepararCompra(f.compra, f.usuario.id);
    await assert.rejects(f.servicio.procesarPago(f.compra.claveSolicitud, f.pago, f.usuario.id));
    await assert.rejects(f.servicio.procesarPago(f.compra.claveSolicitud, f.pago, f.usuario.id));
    const result = await f.servicio.consultarIntento(f.compra.claveSolicitud, f.usuario.id);
    assert.equal(result.estadoOperacion, "INCIERTA");
    assert.equal((await db.producto.findUniqueOrThrow({ where: { id: f.producto.id } })).stock, 8);
    assert.equal(await db.pedido.count({ where: { usuarioId: f.usuario.id } }), 0);
  });

  await t.test("una operación incierta antigua no se reenvía ni libera stock", async (st) => {
    const f = await fixture(st);
    const crear = f.proveedor.crearYProcesarOrden;
    f.proveedor.crearYProcesarOrden = async datos => { await crear(datos); throw new ErrorOrdersMP(null); };
    await f.servicio.prepararCompra(f.compra, f.usuario.id);
    await assert.rejects(f.servicio.procesarPago(f.compra.claveSolicitud, f.pago, f.usuario.id));
    await db.operacionCobro.updateMany({ where: { intentoId: f.compra.claveSolicitud }, data: { creadoEn: new Date(0) } });
    const result = await f.servicio.procesarPago(f.compra.claveSolicitud, f.pago, f.usuario.id);
    assert.equal(result.estadoOperacion, "INCIERTA");
    assert.equal(f.llamadas.length, 1);
    assert.equal((await db.producto.findUniqueOrThrow({ where: { id: f.producto.id } })).stock, 8);
  });

  await t.test("orden pendiente vencida se cancela en MP antes de liberar stock", async (st) => {
    const f = await fixture(st);
    const crear = f.proveedor.crearYProcesarOrden;
    f.proveedor.crearYProcesarOrden = async datos => Object.assign(await crear(datos), {
      status: "processing", status_detail: "in_process", total_paid_amount: "0.00",
    });
    await f.servicio.prepararCompra(f.compra, f.usuario.id);
    const pendiente = await f.servicio.procesarPago(f.compra.claveSolicitud, f.pago, f.usuario.id);
    assert.equal(pendiente.estado, "EN_PROCESO");
    await db.intentoCompra.update({ where: { id: f.compra.claveSolicitud }, data: { expiraEn: new Date(0) } });
    const orden = [...f.ordenes.values()][0];
    const cancelaciones = [];
    st.mock.method(globalThis, "fetch", async (url, options) => {
      cancelaciones.push({ url, options });
      orden.status = "cancelled";
      orden.status_detail = "cancelled";
      return new Response(JSON.stringify(orden));
    });
    const final = await f.servicio.consultarIntento(f.compra.claveSolicitud, f.usuario.id);
    assert.equal(final.estado, "EXPIRADO");
    assert.equal(cancelaciones[0].options.method, "POST");
    assert.ok(cancelaciones[0].url.endsWith("/cancel"));
    assert.equal((await db.producto.findUniqueOrThrow({ where: { id: f.producto.id } })).stock, 10);
  });

  await t.test("3DS expone solo HTTPS verificado y no confirma antes de la acreditación", async (st) => {
    const f = await fixture(st);
    const crear = f.proveedor.crearYProcesarOrden;
    f.proveedor.crearYProcesarOrden = async datos => Object.assign(await crear(datos), {
      status: "action_required", status_detail: "waiting_challenge", total_paid_amount: "0.00",
      transactions: { payments: [{ payment_method: { transaction_security: {
        type: "challenge", status: "pending", url: "https://banco.example.test/challenge",
      } } }] },
    });
    await f.servicio.prepararCompra(f.compra, f.usuario.id);
    const result = await f.servicio.procesarPago(f.compra.claveSolicitud, f.pago, f.usuario.id);
    assert.equal(result.estado, "EN_PROCESO");
    assert.equal(result.autenticacion.url, "https://banco.example.test/challenge");
    assert.equal(f.llamadas[0].modoCaptura, "automatic_async");
    assert.equal(await db.pedido.count({ where: { usuarioId: f.usuario.id } }), 0);
    const orden = [...f.ordenes.values()][0];
    for (const url of ["http://banco.example.test/challenge", "javascript:alert(1)", "https://usuario:clave@banco.example.test/challenge"]) {
      orden.transactions.payments[0].payment_method.transaction_security.url = url;
      assert.equal((await f.servicio.consultarIntento(f.compra.claveSolicitud, f.usuario.id)).autenticacion, null);
    }
    orden.transactions.payments[0].payment_method = { redirect_url: "https://banco.example.test/challenge" };
    assert.equal((await f.servicio.consultarIntento(f.compra.claveSolicitud, f.usuario.id)).autenticacion.url, "https://banco.example.test/challenge");
    orden.status = "processed";
    orden.status_detail = "accredited";
    orden.total_paid_amount = "51.00";
    const confirmado = await f.servicio.consultarIntento(f.compra.claveSolicitud, f.usuario.id);
    assert.equal(confirmado.estado, "CONFIRMADO");
    assert.equal(confirmado.autenticacion, null);
    assert.equal(await db.pedido.count({ where: { usuarioId: f.usuario.id } }), 1);
  });

  await t.test("vendedor, moneda, referencia e importe ajenos no confirman pedidos", async (st) => {
    for (const cambio of [{ user_id: "999" }, { currency: "USD" }, { external_reference: "ajena" }, { total_amount: "0.01" }, { total_paid_amount: "0.01" }]) {
      const f = await fixture(st);
      const crear = f.proveedor.crearYProcesarOrden;
      f.proveedor.crearYProcesarOrden = async datos => Object.assign(await crear(datos), cambio);
      await f.servicio.prepararCompra(f.compra, f.usuario.id);
      try { await f.servicio.procesarPago(f.compra.claveSolicitud, f.pago, f.usuario.id); } catch { /* Debe quedar incierto. */ }
      assert.equal(await db.pedido.count({ where: { usuarioId: f.usuario.id } }), 0);
      assert.equal((await db.producto.findUniqueOrThrow({ where: { id: f.producto.id } })).stock, 8);
    }
  });

  await t.test("reserva vencida o cancelada sin cobro libera stock", async (st) => {
    for (const cancelar of [true, false]) {
      const f = await fixture(st);
      await f.servicio.prepararCompra(f.compra, f.usuario.id);
      if (!cancelar) await db.intentoCompra.update({ where: { id: f.compra.claveSolicitud }, data: { expiraEn: new Date(0) } });
      const result = cancelar
        ? await f.servicio.cancelarIntento(f.compra.claveSolicitud, f.usuario.id)
        : await f.servicio.consultarIntento(f.compra.claveSolicitud, f.usuario.id);
      assert.equal(result.estado, cancelar ? "CANCELADO" : "EXPIRADO");
      assert.equal(f.llamadas.length, 0);
      assert.equal((await db.producto.findUniqueOrThrow({ where: { id: f.producto.id } })).stock, 10);
    }
  });

  await t.test("HTTP 400 definitivo permite terminar el intento sin retener stock", async (st) => {
    const f = await fixture(st);
    f.proveedor.crearYProcesarOrden = async () => { throw new ErrorOrdersMP(400); };
    await f.servicio.prepararCompra(f.compra, f.usuario.id);
    const result = await f.servicio.procesarPago(f.compra.claveSolicitud, f.pago, f.usuario.id);
    assert.equal(result.estado, "RECHAZADO");
    assert.equal(result.solicitudRechazada, true);
    assert.match(result.aviso, /No se pudo iniciar el pago.*HTTP 400/);
    assert.equal((await db.producto.findUniqueOrThrow({ where: { id: f.producto.id } })).stock, 10);
  });

  await t.test("REDIRECCION conserva la conciliación de órdenes anteriores", async (st) => {
    const f = await fixture(st);
    await f.servicio.prepararCompra(f.compra, f.usuario.id);
    await db.intentoCompra.update({ where: { id: f.compra.claveSolicitud }, data: { modalidad: "REDIRECCION" } });
    await db.pago.update({ where: { intentoId: f.compra.claveSolicitud }, data: { idOrdenExterna: "LEGACY-TEST" } });
    st.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
      id: "LEGACY-TEST", user_id: "123", currency: "MXN", total_amount: "51.00", total_paid_amount: "51.00",
      external_reference: `TL-INTENTO-${f.compra.claveSolicitud}`, status: "processed", status_detail: "accredited",
    })));
    const result = await f.servicio.consultarIntento(f.compra.claveSolicitud, f.usuario.id);
    assert.equal(result.estado, "CONFIRMADO");
    assert.equal(f.llamadas.length, 0);
  });
});
