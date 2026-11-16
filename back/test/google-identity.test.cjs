const { test } = require("node:test");
const assert = require("node:assert/strict");
const { generateKeyPairSync, sign } = require("node:crypto");
require("reflect-metadata");
const { OAuth2Client } = require("google-auth-library");
const { JwtService } = require("@nestjs/jwt");
const { GoogleIdentityService } = require("../dist/google-identity.service");
const { AuthService } = require("../dist/auth.service");
const { AuthResolver } = require("../dist/tienda.resolver");

test("Google: verifica firmas reales, audiencia, emisor, expiración, nonce y correo verificado", async (t) => {
  const previous = process.env.GOOGLE_CLIENT_ID;
  process.env.GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  t.mock.method(
    OAuth2Client.prototype,
    "getFederatedSignonCertsAsync",
    async () => ({
      certs: { prueba: keys.publicKey.export({ type: "spki", format: "pem" }) },
      format: "PEM",
    }),
  );
  const nonce = "a".repeat(43);
  const now = Math.floor(Date.now() / 1000);
  const credential = (changes = {}, privateKey = keys.privateKey) => {
    const encode = (value) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const content = `${encode({ alg: "RS256", kid: "prueba" })}.${encode({
      iss: "https://accounts.google.com",
      aud: process.env.GOOGLE_CLIENT_ID,
      sub: "google-123",
      email: "Cliente@example.test",
      email_verified: true,
      name: "Cliente Google",
      iat: now - 10,
      exp: now + 3600,
      nonce,
      ...changes,
    })}`;
    return `${content}.${sign("RSA-SHA256", Buffer.from(content), privateKey).toString("base64url")}`;
  };
  const service = new GoogleIdentityService();
  try {
    assert.deepEqual(await service.verificar(credential(), nonce), {
      subject: "google-123",
      email: "cliente@example.test",
      nombre: "Cliente Google",
    });
    for (const changes of [
      { aud: "another-client" },
      { iss: "https://attacker.test" },
      { iat: now - 7200, exp: now - 3600 },
      { nonce: "otro" },
      { email_verified: false },
      { sub: "" },
    ]) {
      await assert.rejects(
        service.verificar(credential(changes), nonce),
        (e) => e.extensions.code === "UNAUTHENTICATED",
      );
    }
    const attacker = generateKeyPairSync("rsa", { modulusLength: 2048 });
    await assert.rejects(
      service.verificar(credential({}, attacker.privateKey), nonce),
    );
    await assert.rejects(service.verificar("malformado", nonce));
    delete process.env.GOOGLE_CLIENT_ID;
    await assert.rejects(
      service.verificar(credential(), nonce),
      (e) => e.extensions.code === "GOOGLE_UNAVAILABLE",
    );
  } finally {
    if (previous === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = previous;
  }
});

test("Google: crea clientes, vincula con contraseña y conserva ID, rol y versión de sesión", async () => {
  let identity = {
    subject: "google-123",
    email: "cliente@example.test",
    nombre: "Cliente",
  };
  const users = [];
  const db = {
    usuario: {
      findUnique: async ({ where }) =>
        users.find((user) =>
          Object.entries(where).every(([key, value]) => user[key] === value),
        ) || null,
      create: async ({ data }) => {
        const user = {
          id: users.length + 1,
          versionSesion: 0,
          passwordHash: null,
          googleSubject: null,
          ...data,
        };
        users.push(user);
        return user;
      },
      updateMany: async ({ where, data }) => {
        const user = users.find((user) =>
          Object.entries(where).every(([key, value]) => user[key] === value),
        );
        if (!user) return { count: 0 };
        Object.assign(user, data);
        return { count: 1 };
      },
    },
  };
  const jwt = new JwtService({ secret: "test-google-auth-secret" });
  const auth = new AuthService(db, jwt, { verificar: async () => identity });
  const datos = { credential: "verificado", nonce: "a".repeat(43) };
  const created = await auth.iniciarSesionGoogle(datos);
  assert.equal(created.usuario.rol, "CLIENTE");
  assert.equal(created.usuario.id, 1);
  assert.equal(users[0].passwordHash, null);
  assert.equal((await auth.iniciarSesionGoogle(datos)).usuario.id, 1);
  assert.equal(users.length, 1);
  identity = { ...identity, email: "correo-nuevo@example.test" };
  assert.equal((await auth.iniciarSesionGoogle(datos)).usuario.id, 1);

  await auth.registrar({
    nombre: "Cuenta existente",
    email: "existente@example.test",
    password: "password-segura",
  });
  users[1].rol = "ADMIN";
  users[1].versionSesion = 3;
  identity = {
    subject: "google-456",
    email: "existente@example.test",
    nombre: "Otro nombre",
  };
  await assert.rejects(
    auth.iniciarSesionGoogle(datos),
    (e) => e.extensions.code === "GOOGLE_LINK_REQUIRED",
  );
  await assert.rejects(
    auth.iniciarSesionGoogle({ ...datos, password: "incorrecta" }),
  );
  assert.equal(users[1].googleSubject, null);
  const linked = await auth.iniciarSesionGoogle({
    ...datos,
    password: "password-segura",
  });
  assert.equal(linked.usuario.id, 2);
  assert.equal(linked.usuario.rol, "ADMIN");
  assert.equal(jwt.verify(linked.token).sv, 3);
  assert.equal(users.length, 2);
  assert.equal((await auth.iniciarSesionGoogle(datos)).usuario.id, 2);
  identity = { ...identity, subject: "google-distinto" };
  await assert.rejects(
    auth.iniciarSesionGoogle({ ...datos, password: "password-segura" }),
    (e) => e.extensions.code === "CONFLICT",
  );
});

test("la mutación de Google rechaza llamadas que no proceden del puente Astro", () => {
  const resolver = new AuthResolver({
    iniciarSesionGoogle: () => {
      throw new Error("No debe ejecutarse");
    },
  });
  assert.throws(
    () => resolver.iniciarSesionGoogle({}, { req: { headers: {} } }),
    (e) => e.extensions.code === "FORBIDDEN",
  );
});
