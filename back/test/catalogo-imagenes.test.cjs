const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, rm, readFile } = require("node:fs/promises");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { randomBytes } = require("node:crypto");
require("reflect-metadata");
const { Module } = require("@nestjs/common");
const { NestFactory } = require("@nestjs/core");
const { JwtService } = require("@nestjs/jwt");
const { Prisma } = require("@prisma/client");
const sharp = require("sharp");
const { AuthService } = require("../dist/auth.service");
const { ImagenesController } = require("../dist/imagenes.controller");
const { errorCatalogo } = require("../dist/catalogo-error");

// La consulta de usuario se simula; JWT, HTTP, permisos, decodificación y disco son reales.
test("imágenes: permisos, validación del contenido, almacenamiento y lectura HTTP", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "tecnoleague-images-"));
  const previous = process.env.IMAGE_UPLOAD_DIR;
  process.env.IMAGE_UPLOAD_DIR = directory;
  const jwt = new JwtService({
    secret: randomBytes(32).toString("hex"),
    signOptions: { expiresIn: "5m" },
  });
  const auth = new AuthService(
    {
      usuario: {
        findUnique: async ({ where }) => ({
          id: where.id,
          rol: where.id === 1 ? "ADMIN" : "CLIENTE",
        }),
      },
    },
    jwt,
  );
  class ImagesModule {}
  Module({
    controllers: [ImagenesController],
    providers: [{ provide: AuthService, useValue: auth }],
  })(ImagesModule);
  let app = await NestFactory.create(ImagesModule, { logger: false });
  try {
    await app.listen(0, "127.0.0.1");
    let base = `http://127.0.0.1:${app.getHttpServer().address().port}/imagenes`;
    const png = await sharp({
      create: { width: 20, height: 10, channels: 3, background: "#ffaa22" },
    })
      .png()
      .toBuffer();
    const admin = jwt.sign({ sub: 1 });
    const upload = (body, type = "image/png", token = admin) =>
      fetch(base, {
        method: "POST",
        headers: {
          "Content-Type": type,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body,
      });
    await t.test(
      "rechaza sesiones ausentes, alteradas y clientes",
      async () => {
        assert.equal((await upload(png, "image/png", "")).status, 401);
        assert.equal((await upload(png, "image/png", "alterado")).status, 401);
        assert.equal(
          (await upload(png, "image/png", jwt.sign({ sub: 2 }))).status,
          403,
        );
      },
    );
    await t.test(
      "guarda PNG/JPEG y los sirve tras reiniciar el servidor",
      async () => {
        const files = [];
        for (const [buffer, type, extension] of [
          [png, "image/png", "png"],
          [await sharp(png).jpeg().toBuffer(), "image/jpeg", "jpg"],
        ]) {
          const response = await upload(buffer, type);
          assert.equal(response.status, 201);
          const { imagen } = await response.json();
          assert.match(
            imagen,
            new RegExp(`^/images/uploads/[a-f0-9-]{36}\\.${extension}$`),
          );
          const file = imagen.split("/").pop();
          files.push(file);
          const stored = await readFile(join(directory, file));
          const metadata = await sharp(stored).metadata();
          assert.equal(metadata.format, extension === "jpg" ? "jpeg" : "png");
          assert.equal(metadata.width, 20);
          const get = await fetch(`${base}/${file}`);
          assert.equal(get.status, 200);
          assert.equal(get.headers.get("content-type"), type);
          assert.deepEqual(Buffer.from(await get.arrayBuffer()), stored);
        }
        await app.close();
        app = await NestFactory.create(ImagesModule, { logger: false });
        await app.listen(0, "127.0.0.1");
        base = `http://127.0.0.1:${app.getHttpServer().address().port}/imagenes`;
        for (const file of files)
          assert.equal((await fetch(`${base}/${file}`)).status, 200);
      },
    );
    await t.test(
      "rechaza archivos disfrazados, MIME incorrecto y más de 5 MB",
      async () => {
        assert.equal(
          (await upload(Buffer.from("<script>alert(1)</script>"))).status,
          400,
        );
        assert.equal((await upload(png, "image/jpeg")).status, 400);
        assert.equal((await upload(png, "image/svg+xml")).status, 415);
        assert.equal(
          (await upload(Buffer.alloc(5 * 1024 * 1024 + 1))).status,
          413,
        );
      },
    );
    await t.test(
      "rechaza rutas arbitrarias y archivos inexistentes",
      async () => {
        assert.equal((await fetch(`${base}/package.json`)).status, 404);
        assert.equal(
          (await fetch(`${base}/00000000-0000-0000-0000-000000000000.jpg`))
            .status,
          404,
        );
      },
    );
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.IMAGE_UPLOAD_DIR;
    else process.env.IMAGE_UPLOAD_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("catálogo: distingue nombres repetidos de IDs desincronizados y fallos de base de datos", () => {
  const known = (code, target) =>
    new Prisma.PrismaClientKnownRequestError("Detalle privado", {
      code,
      clientVersion: "6.19.3",
      meta: { target },
    });
  assert.throws(
    () => errorCatalogo(known("P2002", ["nombre"]), "categoría"),
    (e) => e.extensions.code === "CONFLICT" && e.message.includes("ese nombre"),
  );
  for (const entity of ["categoría", "producto"]) {
    assert.throws(
      () => errorCatalogo(known("P2002", ["id"]), entity),
      (e) =>
        e.extensions.code === "ID_SEQUENCE_CONFLICT" &&
        !e.message.includes("ese nombre") &&
        e.message.includes("db:repair-sequences"),
    );
  }
  assert.throws(
    () => errorCatalogo(known("P2022"), "producto"),
    (e) => e.extensions.code === "DATABASE_SCHEMA_MISMATCH",
  );
  assert.throws(
    () => errorCatalogo(known("P2024"), "producto"),
    (e) =>
      e.extensions.code === "DATABASE_UNAVAILABLE" &&
      !e.message.includes("Detalle privado"),
  );
  const unknown = new Error("otro");
  assert.throws(
    () => errorCatalogo(unknown, "producto"),
    (e) => e === unknown,
  );
});
