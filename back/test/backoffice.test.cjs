const { test } = require('node:test');
process.env.MP_RECONCILIATION_DISABLED = '1';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
require('reflect-metadata');
require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });
const { NestFactory } = require('@nestjs/core');
const { createClient } = require('graphql-ws');
const WebSocket = require('ws');
const { AppModule } = require('../dist/app.module');
const { EventosService } = require('../dist/eventos.service');
const { PrismaService } = require('../dist/prisma.service');
const { PagosService } = require('../dist/pagos.service');
const { TiendaService } = require('../dist/tienda.service');
const { AdminService } = require('../dist/admin.service');
const { JwtService } = require('@nestjs/jwt');
const query = 'subscription { backOfficeActualizado { eventoId entidad entidadId accion ocurridoEn } }';

test('BackOffice: operaciones reales, permisos y pagos con proveedor simulado', { timeout: 60000 }, async t => {
  const app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  const port = app.getHttpServer().address().port;
  const db = app.get(PrismaService);
  const eventos = app.get(EventosService);
  const recibidos = [];
  const clientes = [];
  let stop;
  try {
    const admin = await db.usuario.findUniqueOrThrow({ where: { email: process.env.ADMIN_EMAIL } });
    const token = app.get(JwtService).sign({ sub: admin.id }, { expiresIn: "5m" });
    const client = createClient({ url: `ws://127.0.0.1:${port}/graphql`, webSocketImpl: WebSocket,
      retryAttempts: 0, connectionParams: { authorization: `Bearer ${token}` } });
    clientes.push(client);
    let listo;
    const preparado = new Promise(resolve => { listo = resolve; });
    stop = client.subscribe({ query }, {
      next: result => {
        assert.equal(result.errors, undefined);
        for (const e of [result.data.backOfficeActualizado]) {
          if (e.entidadId === 0) listo(); else recibidos.push(e);
        }
      }, error: error => listo(Promise.reject(error)), complete() {},
    });
    // Barrera de preparación: verifica recepción, no solo conexión del socket.
    const interval = setInterval(() => { void eventos.publicarBackOffice({ entidad: 'PEDIDO', entidadId: 0, accion: 'CREADO' }); }, 20);
    try { await preparado; } finally { clearInterval(interval); }

    await t.test('rechaza sin sesión y con rol CLIENTE', async () => {
      const comprador = await db.usuario.create({ data: { nombre: 'TEST subscription', email: `sub-${randomUUID()}@example.test`, passwordHash: 'no-login-test', rol: 'CLIENTE' } });
      for (const authorization of [undefined, 'Bearer invalido', `Bearer ${app.get(JwtService).sign({ sub: comprador.id }, { expiresIn: "5m" })}`]) {
        const c = createClient({ url: `ws://127.0.0.1:${port}/graphql`, webSocketImpl: WebSocket,
          retryAttempts: 0, connectionParams: authorization ? { authorization } : {} });
        clientes.push(c);
        await assert.rejects(async () => { for await (const r of c.iterate({ query })) {
          if (r.errors) throw new Error(JSON.stringify(r.errors));
          assert.fail('No debe recibir eventos');
        } }, /UNAUTHENTICATED|FORBIDDEN|Inicia sesión|permiso/);
        await c.dispose();
      }
    });

    await t.test('CRUD, compras, cancelación, inventario, rollback e idempotencia', async () => {
      await promisify(execFile)(process.execPath, ['scripts/test-api.mjs'], {
        cwd: path.join(__dirname, '../..'), env: { ...process.env, TEST_API_URL: `http://127.0.0.1:${port}/graphql` }, timeout: 30000,
      });
      // Una barrera posterior confirma que llegaron las publicaciones anteriores.
      let resolver;
      const barrera = new Promise(resolve => { resolver = resolve; });
      const cancelar = client.subscribe({ query }, { next: r => { if (r.data?.backOfficeActualizado.entidadId === 0) resolver(); }, error: resolver, complete() {} });
      const timer = setInterval(() => { void eventos.publicarBackOffice({ entidad: 'PEDIDO', entidadId: 0, accion: 'CREADO' }); }, 20);
      try { await barrera; } finally { clearInterval(timer); cancelar(); }
      for (const [entidad, accion] of [['PRODUCTO','CREADO'],['PRODUCTO','ACTUALIZADO'],['PRODUCTO','DESACTIVADO'],['CATEGORIA','CREADO'],['CATEGORIA','ACTUALIZADO'],['CATEGORIA','ELIMINADO'],['PEDIDO','CREADO'],['PEDIDO','ACTUALIZADO'],['INVENTARIO','ACTUALIZADO']]) {
        assert.ok(recibidos.some(e => e.entidad === entidad && e.accion === accion), `${entidad}/${accion}`);
      }
      assert.equal(recibidos.filter(e => e.entidad === 'PEDIDO' && e.accion === 'CREADO').length, 2, 'solo dos compras nuevas; rollback y reintentos no publican');
      assert.equal(recibidos.filter(e => e.entidad === 'INVENTARIO').length, 7, 'stock inicial, dos compras, dos cancelaciones y dos ajustes; fallos no publican');
      for (const e of recibidos) {
        assert.ok(e.eventoId); assert.ok(Number.isFinite(Date.parse(e.ocurridoEn)));
        if (e.entidad === 'PEDIDO') assert.ok(await db.pedido.findUnique({ where: { id: e.entidadId } }));
      }
    });

    await t.test('checkout actualizado: reserva, confirmación, rechazo y duplicados', async () => {
      const pagos = app.get(PagosService);
      const publicados = [];
      const originalPublish = eventos.publicarBackOffice.bind(eventos);
      eventos.publicarBackOffice = async e => { publicados.push(e); await originalPublish(e); };
      const originalFetch = global.fetch;
      const nombres = ['MP_ACCESS_TOKEN','MP_COLLECTOR_ID','MP_RETURN_BASE_URL','MP_WEBHOOK_URL','MP_WEBHOOK_SECRET'];
      const anteriores = nombres.map(n => process.env[n]);
      ['test-no-network','12345','http://127.0.0.1:5173','https://example.test/webhook','test-only'].forEach((v,i) => process.env[nombres[i]] = v);
      let estado = 'created', detalle = 'pending', incorrecto = false;
      const ordenes = new Map();
      global.fetch = async (url, options) => {
        assert.ok(String(url).startsWith('https://api.mercadopago.com/'));
        const ruta = new URL(url).pathname;
        let orden;
        if (options.method === 'POST' && ruta === '/v1/orders') {
          const payload = JSON.parse(options.body);
          orden = { id: 'TEST-' + randomUUID(), user_id: '12345', currency: 'MXN', external_reference: payload.external_reference, total_amount: payload.total_amount, checkout_url: 'https://www.mercadopago.com.mx/test' };
          ordenes.set(orden.id, orden);
        } else {
          orden = ordenes.get(decodeURIComponent(ruta.split('/')[3]));
          assert.ok(orden, 'orden simulada conocida');
        }
        return new Response(JSON.stringify({ ...orden, status: estado, status_detail: detalle, total_amount: incorrecto ? '0.01' : orden.total_amount, total_paid_amount: orden.total_amount }), { status: 200 });
      };
      const producto = await db.producto.findFirstOrThrow({ where: { activo: true, stock: { gt: 3 } } });
      const datos = () => ({ nombre: 'TEST Checkout', email: 'checkout@example.test', direccion: 'Calle de pruebas numero 123', claveSolicitud: randomUUID(), renglones: [{ productoId: producto.id, cantidad: 1 }] });
      try {
        const stockInicial = producto.stock;
        const invalida = datos();
        invalida.renglones.push({ productoId: 2147483647, cantidad: 1 });
        await assert.rejects(() => pagos.iniciarPago(invalida, admin.id), /stock/);
        assert.equal(publicados.length, 0, 'rollback no publica reservas ni pagos');
        assert.equal((await db.producto.findUniqueOrThrow({ where: { id: producto.id } })).stock, stockInicial);
        const solicitud = datos();
        const inicio = await pagos.iniciarPago(solicitud, admin.id);
        assert.equal(inicio.pedidoId, null);
        assert.equal(publicados.filter(e => e.entidad === 'PEDIDO').length, 0, 'reservar no crea un pedido');
        assert.equal(publicados.filter(e => e.entidad === 'INVENTARIO').length, 1);
        assert.equal(publicados.filter(e => e.entidad === 'PAGO' && e.accion === 'CREADO').length, 1);
        assert.equal((await db.producto.findUniqueOrThrow({ where: { id: producto.id } })).stock, stockInicial - 1);
        publicados.length = 0;
        await pagos.iniciarPago(solicitud, admin.id);
        assert.equal(publicados.length, 0, 'reintento pendiente no reserva ni publica de nuevo');
        estado = 'processed'; detalle = 'accredited';
        const confirmado = await pagos.consultarIntento(inicio.intentoId, admin.id);
        assert.equal(confirmado.estado, 'CONFIRMADO');
        assert.ok(await db.pedido.findUnique({ where: { id: confirmado.pedidoId } }));
        assert.deepEqual(publicados.map(e => e.entidad), ['PEDIDO', 'PAGO']);
        assert.equal((await db.producto.findUniqueOrThrow({ where: { id: producto.id } })).stock, stockInicial - 1, 'confirmar no descuenta otra vez');
        const primero = await db.pago.findUniqueOrThrow({ where: { intentoId: inicio.intentoId } });
        publicados.length = 0;
        await pagos.procesarWebhook('order', primero.idOrdenExterna);
        assert.equal(publicados.length, 0, 'webhook duplicado no publica');
        await app.get(AdminService).actualizarEstadoPedido(confirmado.pedidoId, 'ENVIADO', admin.id);
        await app.get(AdminService).actualizarEstadoPedido(confirmado.pedidoId, 'ENTREGADO', admin.id);
        assert.deepEqual(publicados.map(e => e.entidad), ['PEDIDO','PEDIDO']);

        estado = 'created'; detalle = 'pending'; publicados.length = 0;
        const otro = await pagos.iniciarPago(datos(), admin.id);
        publicados.length = 0;
        incorrecto = true;
        const pendiente = await pagos.consultarIntento(otro.intentoId, admin.id);
        assert.equal(pendiente.estado, 'EN_PROCESO');
        assert.equal(publicados.length, 0, 'respuesta no verificada no publica');
        incorrecto = false; estado = 'failed'; detalle = 'rejected';
        const rechazado = await pagos.consultarIntento(otro.intentoId, admin.id);
        assert.equal(rechazado.estado, 'RECHAZADO'); assert.equal(rechazado.pedidoId, null);
        assert.deepEqual(publicados.map(e => e.entidad), ['PAGO','INVENTARIO']);
        assert.equal((await db.producto.findUniqueOrThrow({ where: { id: producto.id } })).stock, stockInicial - 1);
        const segundo = await db.pago.findUniqueOrThrow({ where: { intentoId: otro.intentoId } });
        publicados.length = 0;
        await pagos.procesarWebhook('order', segundo.idOrdenExterna);
        assert.equal(publicados.length, 0, 'rechazo duplicado no libera ni publica otra vez');
      } finally {
        global.fetch = originalFetch; eventos.publicarBackOffice = originalPublish;
        nombres.forEach((n,i) => { if (anteriores[i] === undefined) delete process.env[n]; else process.env[n] = anteriores[i]; });
      }
    });
  } finally {
    stop?.();
    await Promise.all(clientes.map(c => c.dispose()));
    await app.close();
  }
});
