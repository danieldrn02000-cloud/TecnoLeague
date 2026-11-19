//Prueba de integracion:
//Se inicia un backend de prueba, se conecta por WebSocket, reutiliza las pruebas de API
//Ademas comprueba el checkout actualizado con mercado pago simulado

const { test } = require("node:test");
process.env.MP_RECONCILIATION_DISABLED = "1";
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const path = require("node:path");
require("reflect-metadata");
require("dotenv").config({
  path: path.join(__dirname, "../.env"),
  quiet: true,
});

const { NestFactory } = require("@nestjs/core");
const { JwtService } = require("@nestjs/jwt");
const { createClient } = require("graphql-ws");
const WebSocket = require("ws");
const { AppModule } = require("../dist/app.module");
const { EventosService } = require("../dist/eventos.service");
const { PrismaService } = require("../dist/prisma.service");
const { PagosService } = require("../dist/pagos.service");
const { TiendaService } = require("../dist/tienda.service");
const { AdminService } = require("../dist/admin.service");
const { AuthService } = require("../dist/auth.service");
const query =
  "subscription { backOfficeActualizado { eventoId entidad entidadId accion ocurridoEn } }";

test(
  "BackOffice: operaciones reales, permisos y pagos con proveedor simulado",
  { timeout: 60000 },
  async (t) => {
    const app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, "127.0.0.1");
    const port = app.getHttpServer().address().port;
    const db = app.get(PrismaService);
    const eventos = app.get(EventosService);
    const recibidos = [];
    const clientes = [];
    let stop;
    try {
      const admin = await db.usuario.findUniqueOrThrow({
        where: { email: process.env.ADMIN_EMAIL},
      });
      const client = createClient({
        url: `ws://127.0.0.1:${port}/graphql`,
        webSocketImpl: WebSocket,
        retryAttempts: 0,
        connectionParams: { ticket: app.get(AuthService).crearTicketBackOffice(admin.id).ticket },
      });
      clientes.push(client);
      let listo;
      const preparado = new Promise((resolve) => {
        listo = resolve;
      });
      stop = client.subscribe(
        { query },
        {
          next: (result) => {
            assert.equal(result.errors, undefined);
            for (const e of [result.data.backOfficeActualizado]) {
              if (e.entidadId === 0) listo();
              else recibidos.push(e);
            }
          },
          error: (error) => listo(Promise.reject(error)),
          complete() {},
        },
      );
      // Barrera de preparación: verifica recepción, no solo conexión del socket.
      const interval = setInterval(() => {
        void eventos.publicarBackOffice({
          entidad: "PEDIDO",
          entidadId: 0,
          accion: "CREADO",
        });
      }, 20);
      try {
        await preparado;
      } finally {
        clearInterval(interval);
      }

      const jwt = app.get(JwtService);
      const tokenPara = (usuario) => jwt.sign(
        { sub: usuario.id, sv: usuario.versionSesion },
        { expiresIn: "5m" },
      );
      const tokenAdmin = tokenPara(admin);
      const graphql = async (query, variables, token) => {
        const response = await fetch(`http://127.0.0.1:${port}/graphql`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ query, variables }),
        });
        return response.json();
      };

      await t.test("guía pública, edición protegida y control de revisiones", async (st) => {
        const anterior = await db.guiaGamer.findUniqueOrThrow({ where: { id: 1 } });
        st.after(() => db.guiaGamer.update({
          where: { id: 1 },
          data: { textos: anterior.textos, revision: anterior.revision },
        }));
        const guardar = `mutation($revision:Int!, $textos:[TextoGuiaGamerInput!]!) {
          guardarGuiaGamer(revision:$revision, textos:$textos) { revision }
        }`;
        const variables = { revision: anterior.revision, textos: [{ clave: "introduccion.texto2", texto: "Título actualizado" }] };
        assert.equal((await graphql(guardar, variables)).errors[0].extensions.code, "UNAUTHENTICATED");
        const guardada = await graphql(guardar, variables, tokenAdmin);
        assert.equal(guardada.errors, undefined, JSON.stringify(guardada.errors));
        assert.equal(guardada.data.guardarGuiaGamer.revision, anterior.revision + 1);
        const consulta = await graphql("{ guiaGamer { revision textos { clave texto } } }");
        assert.deepEqual(consulta.data.guiaGamer.textos, variables.textos);
        assert.equal((await graphql(guardar, variables, tokenAdmin)).errors[0].extensions.code, "CONFLICT");
      });

      await t.test("solo admins cambian roles ajenos y se invalidan las sesiones anteriores", async (st) => {
        const cuenta = await db.usuario.create({
          data: { nombre: "Cuenta de prueba", email: `rol-${randomUUID()}@example.test` },
        });
        st.after(() => db.usuario.delete({ where: { id: cuenta.id } }));
        const cambiar = `mutation($id:Int!, $rol:Rol!) { cambiarRolUsuario(id:$id, rol:$rol) { rol } }`;
        const promover = { id: cuenta.id, rol: "ADMIN" };
        const cliente = tokenPara(cuenta);
        assert.equal((await graphql(cambiar, promover, cliente)).errors[0].extensions.code, "FORBIDDEN");
        assert.equal((await graphql(cambiar, { id: admin.id, rol: "CLIENTE" }, tokenAdmin)).errors[0].extensions.code, "FORBIDDEN");
        assert.equal((await graphql(cambiar, promover, tokenAdmin)).data.cambiarRolUsuario.rol, "ADMIN");
        assert.equal((await graphql("{ verificarAdmin }", {}, cliente)).errors[0].extensions.code, "UNAUTHENTICATED");
        const conRolNuevo = await db.usuario.findUniqueOrThrow({ where: { id: cuenta.id } });
        const nuevoToken = tokenPara(conRolNuevo);
        assert.equal((await graphql("{ verificarAdmin }", {}, nuevoToken)).data.verificarAdmin, true);
        const listado = await graphql("{ adminClientes(incluirAdministradores:true) { items { id rol } } }", {}, tokenAdmin);
        assert.ok(listado.data.adminClientes.items.some(item => item.id === cuenta.id && item.rol === "ADMIN"));
        assert.equal((await graphql(cambiar, { id: cuenta.id, rol: "CLIENTE" }, tokenAdmin)).data.cambiarRolUsuario.rol, "CLIENTE");
        assert.equal((await graphql("{ verificarAdmin }", {}, nuevoToken)).errors[0].extensions.code, "UNAUTHENTICATED");
      });

      await t.test("rechaza sin sesión y con rol CLIENTE", async () => {
        const comprador = await db.usuario.create({
          data: {
            nombre: "TEST subscription",
            email: `sub-${randomUUID()}@example.test`,
            passwordHash: "no-login-test",
            rol: "CLIENTE",
          },
        });
        for (const ticket of [
          undefined,
          "Bearer invalido",
          app.get(AuthService).crearTicketBackOffice(comprador.id).ticket,
        ]) {
          const c = createClient({
            url: `ws://127.0.0.1:${port}/graphql`,
            webSocketImpl: WebSocket,
            retryAttempts: 0,
            connectionParams: ticket ? { ticket } : {},
          });
          clientes.push(c);
          await assert.rejects(async () => {
            for await (const r of c.iterate({ query })) {
              if (r.errors) throw new Error(JSON.stringify(r.errors));
              assert.fail("No debe recibir eventos");
            }
          }, /UNAUTHENTICATED|FORBIDDEN|Inicia sesión|permiso/);
          await c.dispose();
        }
      });

      await t.test(
        "CRUD, compras, cancelación, inventario, rollback e idempotencia",
        async () => {
          await promisify(execFile)(
            process.execPath,
            ["scripts/test-api.mjs"],
            {
              cwd: path.join(__dirname, "../.."),
              env: {
                ...process.env,
                TEST_API_URL: `http://127.0.0.1:${port}/graphql`,
              },
              timeout: 30000,
            },
          );
          // Una barrera posterior confirma que llegaron las publicaciones anteriores.
          let resolver;
          const barrera = new Promise((resolve) => {
            resolver = resolve;
          });
          const cancelar = client.subscribe(
            { query },
            {
              next: (r) => {
                if (r.data?.backOfficeActualizado.entidadId === 0) resolver();
              },
              error: resolver,
              complete() {},
            },
          );
          const timer = setInterval(() => {
            void eventos.publicarBackOffice({
              entidad: "PEDIDO",
              entidadId: 0,
              accion: "CREADO",
            });
          }, 20);
          try {
            await barrera;
          } finally {
            clearInterval(timer);
            cancelar();
          }
          for (const [entidad, accion] of [
            ["PRODUCTO", "CREADO"],
            ["PRODUCTO", "ACTUALIZADO"],
            ["PRODUCTO", "DESACTIVADO"],
            ["CATEGORIA", "CREADO"],
            ["CATEGORIA", "ACTUALIZADO"],
            ["CATEGORIA", "ELIMINADO"],
            ["PEDIDO", "CREADO"],
            ["PEDIDO", "ACTUALIZADO"],
            ["INVENTARIO", "ACTUALIZADO"],
          ]) {
            assert.ok(
              recibidos.some(
                (e) => e.entidad === entidad && e.accion === accion,
              ),
              `${entidad}/${accion}`,
            );
          }
          assert.equal(
            recibidos.filter(
              (e) => e.entidad === "PEDIDO" && e.accion === "CREADO",
            ).length,
            2,
            "solo dos compras nuevas; rollback y reintentos no publican",
          );
          assert.equal(
            recibidos.filter((e) => e.entidad === "INVENTARIO").length,
            7,
            "stock inicial, dos compras, dos cancelaciones y dos ajustes; fallos no publican",
          );
          for (const e of recibidos) {
            assert.ok(e.eventoId);
            assert.ok(Number.isFinite(Date.parse(e.ocurridoEn)));
            if (e.entidad === "PEDIDO")
              assert.ok(
                await db.pedido.findUnique({ where: { id: e.entidadId } }),
              );
          }
        },
      );

      await t.test(
        "checkout actualizado: reserva, confirmación, rechazo y duplicados",
        async () => {
          const pagos = app.get(PagosService);
          const publicados = [];
          const originalPublish = eventos.publicarBackOffice.bind(eventos);
          eventos.publicarBackOffice = async (e) => {
            publicados.push(e);
            await originalPublish(e);
          };
          const originalFetch = global.fetch;
          const nombres = [
            "MP_ACCESS_TOKEN",
            "MP_COLLECTOR_ID",
            "MP_RETURN_BASE_URL",
            "MP_WEBHOOK_URL",
            "MP_WEBHOOK_SECRET",
          ];
          const anteriores = nombres.map((n) => process.env[n]);
          [
            "test-no-network",
            "12345",
            "http://127.0.0.1:5173",
            "https://example.test/webhook",
            "test-only",
          ].forEach((v, i) => (process.env[nombres[i]] = v));
          let estado = "created",
            detalle = "pending",
            incorrecto = false;
          const ordenes = new Map();
          global.fetch = async (url, options) => {
            assert.ok(String(url).startsWith("https://api.mercadopago.com/"));
            const ruta = new URL(url).pathname;
            let orden;
            if (options.method === "POST" && ruta === "/v1/orders") {
              const payload = JSON.parse(options.body);
              orden = {
                id: "TEST-" + randomUUID(),
                user_id: "12345",
                currency: "MXN",
                external_reference: payload.external_reference,
                total_amount: payload.total_amount,
                checkout_url: "https://www.mercadopago.com.mx/test",
              };
              ordenes.set(orden.id, orden);
            } else {
              orden = ordenes.get(decodeURIComponent(ruta.split("/")[3]));
              assert.ok(orden, "orden simulada conocida");
            }
            return new Response(
              JSON.stringify({
                ...orden,
                status: estado,
                status_detail: detalle,
                total_amount: incorrecto ? "0.01" : orden.total_amount,
                total_paid_amount: orden.total_amount,
              }),
              { status: 200 },
            );
          };
          const producto = await db.producto.findFirstOrThrow({
            where: { activo: true, stock: { gt: 3 } },
          });
          const datos = () => ({
            nombre: "TEST Checkout",
            email: "checkout@example.test",
            direccion: "Calle de pruebas numero 123",
            claveSolicitud: randomUUID(),
            renglones: [{ productoId: producto.id, cantidad: 1 }],
          });
          try {
            const stockInicial = producto.stock;
            const invalida = datos();
            invalida.renglones.push({ productoId: 2147483647, cantidad: 1 });
            await assert.rejects(
              () => pagos.iniciarPago(invalida, admin.id),
              /stock/,
            );
            assert.equal(
              publicados.length,
              0,
              "rollback no publica reservas ni pagos",
            );
            assert.equal(
              (
                await db.producto.findUniqueOrThrow({
                  where: { id: producto.id },
                })
              ).stock,
              stockInicial,
            );
            const solicitud = datos();
            const inicio = await pagos.iniciarPago(solicitud, admin.id);
            assert.equal(inicio.pedidoId, null);
            assert.equal(
              publicados.filter((e) => e.entidad === "PEDIDO").length,
              0,
              "reservar no crea un pedido",
            );
            assert.equal(
              publicados.filter((e) => e.entidad === "INVENTARIO").length,
              1,
            );
            assert.equal(
              publicados.filter(
                (e) => e.entidad === "PAGO" && e.accion === "CREADO",
              ).length,
              1,
            );
            assert.equal(
              (
                await db.producto.findUniqueOrThrow({
                  where: { id: producto.id },
                })
              ).stock,
              stockInicial - 1,
            );
            publicados.length = 0;
            await pagos.iniciarPago(solicitud, admin.id);
            assert.equal(
              publicados.length,
              0,
              "reintento pendiente no reserva ni publica de nuevo",
            );
            estado = "processed";
            detalle = "accredited";
            const confirmado = await pagos.consultarIntento(
              inicio.intentoId,
              admin.id,
            );
            assert.equal(confirmado.estado, "CONFIRMADO");
            assert.ok(
              await db.pedido.findUnique({
                where: { id: confirmado.pedidoId },
              }),
            );
            assert.deepEqual(
              publicados.map((e) => e.entidad),
              ["PEDIDO", "PAGO"],
            );
            assert.equal(
              (
                await db.producto.findUniqueOrThrow({
                  where: { id: producto.id },
                })
              ).stock,
              stockInicial - 1,
              "confirmar no descuenta otra vez",
            );
            const primero = await db.pago.findUniqueOrThrow({
              where: { intentoId: inicio.intentoId },
            });
            publicados.length = 0;
            await pagos.procesarWebhook("order", primero.idOrdenExterna);
            assert.equal(publicados.length, 0, "webhook duplicado no publica");
            await app
              .get(AdminService)
              .actualizarEstadoPedido(confirmado.pedidoId, "ENVIADO", admin.id);
            await app
              .get(AdminService)
              .actualizarEstadoPedido(
                confirmado.pedidoId,
                "ENTREGADO",
                admin.id,
              );
            assert.deepEqual(
              publicados.map((e) => e.entidad),
              ["PEDIDO", "PEDIDO"],
            );

            estado = "created";
            detalle = "pending";
            publicados.length = 0;
            const otro = await pagos.iniciarPago(datos(), admin.id);
            publicados.length = 0;
            incorrecto = true;
            const pendiente = await pagos.consultarIntento(
              otro.intentoId,
              admin.id,
            );
            assert.equal(pendiente.estado, "EN_PROCESO");
            assert.equal(
              publicados.length,
              0,
              "respuesta no verificada no publica",
            );
            incorrecto = false;
            estado = "failed";
            detalle = "rejected";
            const rechazado = await pagos.consultarIntento(
              otro.intentoId,
              admin.id,
            );
            assert.equal(rechazado.estado, "RECHAZADO");
            assert.equal(rechazado.pedidoId, null);
            assert.deepEqual(
              publicados.map((e) => e.entidad),
              ["PAGO", "INVENTARIO"],
            );
            assert.equal(
              (
                await db.producto.findUniqueOrThrow({
                  where: { id: producto.id },
                })
              ).stock,
              stockInicial - 1,
            );
            const segundo = await db.pago.findUniqueOrThrow({
              where: { intentoId: otro.intentoId },
            });
            publicados.length = 0;
            await pagos.procesarWebhook("order", segundo.idOrdenExterna);
            assert.equal(
              publicados.length,
              0,
              "rechazo duplicado no libera ni publica otra vez",
            );
          } finally {
            global.fetch = originalFetch;
            eventos.publicarBackOffice = originalPublish;
            nombres.forEach((n, i) => {
              if (anteriores[i] === undefined) delete process.env[n];
              else process.env[n] = anteriores[i];
            });
          }
        },
      );
    } finally {
      stop?.();
      await Promise.all(clientes.map((c) => c.dispose()));
      await app.close();
    }
  },
);
