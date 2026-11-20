const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, rm, readFile, readdir } = require("node:fs/promises");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { randomBytes } = require("node:crypto");
const https = require("node:https");
const { Readable, Writable } = require("node:stream");
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
  const cloudinaryAnterior = process.env.CLOUDINARY_URL;
  const renderAnterior = process.env.RENDER;
  const entornoAnterior = process.env.NODE_ENV;
  delete process.env.CLOUDINARY_URL;
  delete process.env.RENDER;
  process.env.NODE_ENV = "test";
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
          versionSesion: 0,
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
    await t.test("acepta AVIF, WebP, GIF y TIFF y los publica como WebP", async () => {
      for (const [format, type] of [["avif", "image/avif"], ["webp", "image/webp"], ["gif", "image/gif"], ["tiff", "image/tiff"]]) {
        const buffer = await sharp(png).toFormat(format).toBuffer();
        const response = await upload(buffer, type);
        assert.equal(response.status, 201, `Subida de ${format}`);
        const { imagen } = await response.json();
        assert.match(imagen, /\.webp$/);
        const get = await fetch(`${base}/${imagen.split("/").pop()}`);
        assert.equal(get.status, 200);
        assert.equal(get.headers.get("content-type"), "image/webp");
        const metadata = await sharp(Buffer.from(await get.arrayBuffer())).metadata();
        assert.equal(metadata.format, "webp");
        assert.equal(metadata.width, 20);
      }
    });
    await t.test("GIF animado se convierte a una sola imagen", async () => {
      const raw = Buffer.from([
        ...Array.from({ length: 4 }, () => [255, 0, 0, 255]).flat(),
        ...Array.from({ length: 4 }, () => [0, 0, 255, 255]).flat(),
      ]);
      const gif = await sharp(raw, { raw: { width: 2, height: 4, pageHeight: 2, channels: 4 } }).gif({ delay: [100, 100] }).toBuffer();
      assert.equal((await sharp(gif, { animated: true }).metadata()).pages, 2);
      const response = await upload(gif, "image/gif");
      assert.equal(response.status, 201);
      const { imagen } = await response.json();
      const get = await fetch(`${base}/${imagen.split("/").pop()}`);
      const metadata = await sharp(Buffer.from(await get.arrayBuffer())).metadata();
      assert.equal(metadata.format, "webp");
      assert.equal(metadata.height, 2);
      assert.equal(metadata.pages || 1, 1);
    });
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
    await t.test("sube la imagen validada a Cloudinary y devuelve su URL pública", async (t) => {
      const imagen = "https://res.cloudinary.com/tl-test/image/upload/v1/tecnoleague/productos/prueba.webp";
      const discoAnterior = await readdir(directory);
      let estado = 200;
      let respuesta = { secure_url: imagen };
      const solicitudes = [];
      t.mock.method(https, "request", (opciones, callback) => {
        const partes = [];
        const request = new Writable({
          write(parte, encoding, done) {
            partes.push(parte);
            done();
          },
          final(done) {
            solicitudes.push({ opciones, contenido: Buffer.concat(partes) });
            const response = Readable.from([JSON.stringify(respuesta)]);
            response.statusCode = estado;
            callback(response);
            done();
          },
        });
        request.setTimeout = () => request;
        return request;
      });
      process.env.RENDER = "true";
      assert.equal((await upload(png)).status, 503);
      process.env.CLOUDINARY_URL = "configuracion-invalida";
      assert.equal((await upload(png)).status, 503);
      assert.equal(solicitudes.length, 0);

      process.env.CLOUDINARY_URL = "cloudinary://1234:secreto-ficticio@tl-test";
      assert.equal((await upload(png, "image/jpeg")).status, 400);
      assert.equal((await upload(png, "image/png", jwt.sign({ sub: 2 }))).status, 403);
      assert.equal(solicitudes.length, 0);

      const response = await upload(await sharp(png).avif().toBuffer(), "image/avif");
      assert.equal(response.status, 201);
      assert.deepEqual(await response.json(), { imagen });
      assert.equal(solicitudes.length, 1);
      const { opciones, contenido } = solicitudes[0];
      assert.equal(opciones.hostname, "api.cloudinary.com");
      assert.equal(opciones.path, "/v1_1/tl-test/image/upload");
      const multipart = await new Response(contenido, { headers: opciones.headers }).formData();
      assert.equal(multipart.get("api_key"), "1234");
      assert.equal(multipart.get("folder"), "tecnoleague/productos");
      assert.match(multipart.get("signature"), /^[a-f0-9]{40,64}$/);
      assert.ok(!contenido.includes("secreto-ficticio"));
      const archivo = await multipart.get("file").arrayBuffer();
      assert.equal((await sharp(Buffer.from(archivo)).metadata()).format, "webp");

      estado = 401;
      respuesta = { error: { message: "Detalle privado" } };
      const fallo = await upload(png);
      assert.equal(fallo.status, 503);
      assert.equal((await fallo.json()).message, "No se pudo subir la imagen. Inténtalo de nuevo.");
      assert.deepEqual(await readdir(directory), discoAnterior);
    });
  } finally {
    await app.close();
    for (const [nombre, valor] of Object.entries({
      IMAGE_UPLOAD_DIR: previous,
      CLOUDINARY_URL: cloudinaryAnterior,
      RENDER: renderAnterior,
      NODE_ENV: entornoAnterior,
    })) {
      if (valor === undefined) delete process.env[nombre];
      else process.env[nombre] = valor;
    }
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
