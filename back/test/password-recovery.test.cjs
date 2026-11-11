const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
require("reflect-metadata");
const { JwtService } = require("@nestjs/jwt");
const { AuthService } = require("../dist/auth.service");
const { AuthResolver } = require("../dist/tienda.resolver");

test("Recuperación por código y Resend con PostgreSQL", { skip: !process.env.AUTH_TEST_DATABASE_URL }, async t => {
  const { PrismaClient } = require(process.env.AUTH_TEST_PRISMA_CLIENT || "@prisma/client");
  const db = new PrismaClient(process.env.AUTH_TEST_ADAPTER
    ? { adapter: new (require(process.env.AUTH_TEST_ADAPTER).PrismaPg)({ connectionString: process.env.AUTH_TEST_DATABASE_URL }) }
    : { datasources: { db: { url: process.env.AUTH_TEST_DATABASE_URL } } });
  const anteriores = { JWT_SECRET: process.env.JWT_SECRET, RESEND_API_KEY: process.env.RESEND_API_KEY, PASSWORD_RESET_FROM: process.env.PASSWORD_RESET_FROM };
  Object.assign(process.env, { JWT_SECRET: "secreto-exclusivo-de-pruebas-32-caracteres", RESEND_API_KEY: "resend-prueba", PASSWORD_RESET_FROM: "TecnoLeague <acceso@example.test>" });
  const auth = new AuthService(db, new JwtService({ secret: process.env.JWT_SECRET }));
  const correos = [];
  const enviados = [];
  const mock = t.mock.method(globalThis, "fetch", async (url, opciones) => {
    assert.equal(url, "https://api.resend.com/emails");
    const cuerpo = JSON.parse(opciones.body);
    enviados.push({ cuerpo, codigo: cuerpo.text.match(/\b\d{6}\b/)[0] });
    return new Response(JSON.stringify({ id: "correo-prueba" }));
  });
  t.after(async () => {
    await db.tokenRecuperacion.deleteMany({ where: { email: { in: correos } } });
    await db.usuario.deleteMany({ where: { email: { in: correos } } });
    await db.$disconnect();
    for (const [k,v] of Object.entries(anteriores)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });
  async function cuenta() {
    const email = `reset-${randomUUID()}@example.test`; correos.push(email);
    const sesion = await auth.registrar({ nombre: "Prueba recuperación", email, password: "Anterior-123" });
    return { email, sesion };
  }
  await t.test("código correcto, cambio único, contraseña antigua y sesión anterior invalidadas", async () => {
    const { email, sesion } = await cuenta();
    const solicitud = await auth.solicitarRecuperacion(email);
    const codigo = enviados.at(-1).codigo;
    const registro = await db.tokenRecuperacion.findFirst({ where: { email } });
    assert.notEqual(registro.tokenHash, solicitud.solicitudId);
    assert.ok(!JSON.stringify(registro).includes(codigo));
    await assert.rejects(auth.restablecerPassword(solicitud.solicitudId, "Nueva-1234"), /recuperación venció/);
    const token = await auth.verificarCodigoRecuperacion(solicitud.solicitudId, codigo);
    await assert.rejects(auth.verificarCodigoRecuperacion(solicitud.solicitudId, codigo), /incorrecto|venció/);
    await auth.restablecerPassword(token, "Nueva-1234");
    await assert.rejects(auth.restablecerPassword(token, "Otra-1234"), /recuperación venció/);
    await assert.rejects(auth.iniciarSesion({ email, password: "Anterior-123" }), /incorrectos/);
    const nueva = await auth.iniciarSesion({ email, password: "Nueva-1234" });
    await assert.rejects(auth.usuarioActual({ req: { headers: { authorization: `Bearer ${sesion.token}` } } }), /sesión ya no es válida/);
    assert.equal((await auth.usuarioActual({ req: { headers: { authorization: `Bearer ${nueva.token}` } } })).email, email);
  });
  await t.test("cinco códigos incorrectos se confirman y bloquean incluso el código correcto", async () => {
    const { email } = await cuenta();
    const { solicitudId } = await auth.solicitarRecuperacion(email);
    const codigo = enviados.at(-1).codigo;
    const incorrecto = codigo === "111111" ? "222222" : "111111";
    for (let i=0;i<5;i++) await assert.rejects(auth.verificarCodigoRecuperacion(solicitudId, incorrecto));
    assert.equal((await db.tokenRecuperacion.findFirst({ where: { email } })).intentos, 5);
    await assert.rejects(auth.verificarCodigoRecuperacion(solicitudId, codigo));
  });
  await t.test("vencimiento, reenvío y límite persistente de solicitudes", async () => {
    const { email } = await cuenta();
    const anterior = await auth.solicitarRecuperacion(email);
    const codigo = enviados.at(-1).codigo;
    await assert.rejects(auth.solicitarRecuperacion(email), /Espera un minuto/);
    await db.tokenRecuperacion.updateMany({ where: { email }, data: { expiraEn: new Date(0), creadoEn: new Date(Date.now()-61_000) } });
    await assert.rejects(auth.verificarCodigoRecuperacion(anterior.solicitudId, codigo));
    const nuevo = await auth.solicitarRecuperacion(email);
    await assert.rejects(auth.verificarCodigoRecuperacion(anterior.solicitudId, codigo));
    const token = await auth.verificarCodigoRecuperacion(nuevo.solicitudId, enviados.at(-1).codigo);
    assert.equal(typeof token, "string");
    for (let i=0;i<3;i++) {
      await db.tokenRecuperacion.updateMany({ where: { email }, data: { creadoEn: new Date(Date.now()-61_000) } });
      await auth.solicitarRecuperacion(email);
    }
    await db.tokenRecuperacion.updateMany({ where: { email }, data: { creadoEn: new Date(Date.now()-61_000) } });
    await assert.rejects(auth.solicitarRecuperacion(email), /en una hora/);
    await assert.rejects(auth.restablecerPassword(token, "Nueva-1234"));
  });
  await t.test("correo inexistente responde igual sin enviar correo y la configuración falla sin revelar cuentas", async () => {
    const email = `inexistente-${randomUUID()}@example.test`; correos.push(email);
    const cantidad = enviados.length;
    const resultado = await auth.solicitarRecuperacion(email);
    assert.match(resultado.solicitudId, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(resultado.reintentarEn, 60);
    assert.equal(enviados.length, cantidad);
    delete process.env.RESEND_API_KEY;
    await assert.rejects(auth.solicitarRecuperacion(email), /No pudimos enviar/);
    process.env.RESEND_API_KEY = "resend-prueba";
  });
  await t.test("errores de Resend invalidan el código sin registrar su contenido", async () => {
    const { email } = await cuenta();
    mock.mock.mockImplementationOnce(async () => new Response("dato privado", { status: 500 }));
    await assert.rejects(auth.solicitarRecuperacion(email), /No pudimos enviar/);
    assert.ok((await db.tokenRecuperacion.findFirst({ where: { email } })).usadoEn);
  });
  await t.test("dos verificaciones y cambios concurrentes solo consumen una vez el permiso", async () => {
    const { email } = await cuenta();
    const solicitudes = await Promise.allSettled([auth.solicitarRecuperacion(email), auth.solicitarRecuperacion(email)]);
    assert.equal(solicitudes.filter(r => r.status === "fulfilled").length, 1);
    const solicitudId = solicitudes.find(r => r.status === "fulfilled").value.solicitudId;
    const codigo = enviados.at(-1).codigo;
    const verificaciones = await Promise.allSettled([
      auth.verificarCodigoRecuperacion(solicitudId, codigo), auth.verificarCodigoRecuperacion(solicitudId, codigo),
    ]);
    assert.equal(verificaciones.filter(r => r.status === "fulfilled").length, 1);
    const token = verificaciones.find(r => r.status === "fulfilled").value;
    const cambios = await Promise.allSettled([auth.restablecerPassword(token, "Nueva-1234"), auth.restablecerPassword(token, "Otra-1234")]);
    assert.equal(cambios.filter(r => r.status === "fulfilled").length, 1);
  });
  await t.test("solo el puente del servidor puede canjear códigos y cambiar contraseñas", async () => {
    const resolver = new AuthResolver(auth);
    assert.throws(() => resolver.verificarCodigoRecuperacion("a", "123456", { req: { headers: {} } }), /servidor web/);
    assert.throws(() => resolver.restablecerPassword("a", "Nueva-1234", { req: { headers: {} } }), /servidor web/);
  });
});
