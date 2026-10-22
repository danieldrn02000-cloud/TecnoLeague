import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import catalogo from "./catalogo.json";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const db = new PrismaClient();
async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const hash = await new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, 64,
      { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => error ? reject(error) : resolve(key));
  });
  return `scrypt$16384$8$1$${salt}$${hash.toString("base64url")}`;
}

async function prepararAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const nombre = process.env.ADMIN_NAME?.trim() || "Administrador TecnoLeague";
  if (!email && !password) return;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 150 ||
      !password || password.length < 8 || password.length > 128 ||
      nombre.length < 2 || nombre.length > 120) {
    throw new Error("Revisa ADMIN_EMAIL, ADMIN_PASSWORD (8 a 128 caracteres) y ADMIN_NAME.");
  }
  const existente = await db.usuario.findUnique({ where: { email } });
  if (existente) {
    if (existente.rol !== "ADMIN" || !existente.passwordHash) {
      throw new Error("El correo de preparación ya pertenece a una cuenta sin acceso administrativo. Usa otro correo; el seed no cambia roles ni contraseñas existentes.");
    }
    console.log("La cuenta administradora ya existe; no se modificó.");
    return;
  }
  await db.usuario.create({ data: {
    nombre, email, passwordHash: await hashPassword(password), rol: "ADMIN",
  }});
  console.log("Cuenta administradora preparada.");
}

async function seed() {
  for (const [i, nombre] of catalogo.categorias.entries()) {
    await db.categoria.upsert({
      where: { id: i + 1 },
      update: {},
      create: { id: i + 1, nombre },
    });
  }
  await db.usuario.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      nombre: "Cliente de demostración",
      email: "demo@tecnoleague.test",
    },
  });
  for (const producto of catalogo.productos) {
    // No restaura stock ni sobrescribe tus cambios si vuelves a ejecutar el seed.
    await db.producto.upsert({
      where: { id: producto.id },
      update: {},
      create: producto,
    });
  }
  await db.$executeRawUnsafe(readFileSync(join(__dirname, "repair-sequences.sql"), "utf8"));
  await prepararAdmin();
  console.log(
    "Catálogo y cliente de demostración preparados. Los pedidos y cambios existentes se conservan.",
  );
}
seed()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
