import { Prisma } from "@prisma/client";
import { GraphQLError } from "graphql";

export function errorCatalogo(
  error: unknown,
  entidad: "categoría" | "producto",
): never {
  const fail = (message: string, code: string): never => {
    throw new GraphQLError(message, { extensions: { code } });
  };
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const target = error.meta?.target;
    const campos = Array.isArray(target)
      ? target
      : typeof target === "string"
        ? [target]
        : [];
    if (error.code === "P2002") {
      if (
        entidad === "categoría" &&
        campos.some(
          (campo) => campo === "nombre" || campo === "categorias_nombre_key",
        )
      ) {
        fail("Ya existe una categoría con ese nombre.", "CONFLICT");
      }
      if (
        campos.some(
          (campo) =>
            campo === "id" ||
            (typeof campo === "string" && campo.endsWith("_pkey")),
        )
      ) {
        fail(
          `El contador de IDs de la base de datos está desincronizado al guardar ${entidad === "producto" ? "el producto" : "la categoría"}. Ejecuta npm run db:repair-sequences y vuelve a intentar.`,
          "ID_SEQUENCE_CONFLICT",
        );
      }
      fail(
        "Hay un conflicto con un registro existente. Revisa los datos e intenta de nuevo.",
        "CONFLICT",
      );
    }
    if (error.code === "P2025")
      fail(
        entidad === "producto"
          ? "El producto ya no está disponible."
          : "La categoría no existe.",
        "BAD_USER_INPUT",
      );
    if (error.code === "P2003")
      fail(
        "La categoría o el usuario asociado ya no existe. Actualiza los datos e intenta de nuevo.",
        "BAD_USER_INPUT",
      );
    if (["P2021", "P2022"].includes(error.code)) {
      fail(
        "La estructura de la base de datos no está actualizada. Ejecuta npm run db:migrate.",
        "DATABASE_SCHEMA_MISMATCH",
      );
    }
    if (["P1001", "P1002", "P1008", "P1017", "P2024"].includes(error.code)) {
      fail(
        "No se pudo conectar con la base de datos. Revisa DATABASE_URL y la disponibilidad de PostgreSQL o Neon.",
        "DATABASE_UNAVAILABLE",
      );
    }
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    fail(
      "No se pudo conectar con la base de datos. Revisa DATABASE_URL y la disponibilidad de PostgreSQL o Neon.",
      "DATABASE_UNAVAILABLE",
    );
  }
  throw error;
}
