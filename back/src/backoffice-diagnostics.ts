import { Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { GraphQLError } from "graphql";
import type { ServerOptions } from "graphql-ws";

const logger = new Logger("BackOffice");

export function idDiagnostico(valor: unknown): string | undefined {
  return typeof valor === "string" && /^[a-f0-9-]{16,64}$/i.test(valor)
    ? valor
    : undefined;
}

export function errorValidacionBackOffice(error: unknown, id: unknown): never {
  if (error instanceof GraphQLError) throw error;
  const requestId = idDiagnostico(id);
  const prismaCode =
    error instanceof Prisma.PrismaClientKnownRequestError
      ? error.code
      : undefined;
  const schema = prismaCode === "P2021" || prismaCode === "P2022";
  const database =
    error instanceof Prisma.PrismaClientInitializationError ||
    (prismaCode !== undefined &&
      ["P1000", "P1001", "P1002", "P1008", "P1017", "P2024"].includes(
        prismaCode,
      ));
  const code = schema
    ? "DATABASE_SCHEMA_MISMATCH"
    : database
      ? "DATABASE_UNAVAILABLE"
      : "BACKOFFICE_INTERNAL_ERROR";
  // No registrar el error completo: Prisma puede incluir datos de conexión.
  logger.error({
    etapa: "validar_usuario",
    requestId,
    codigo: code,
    prismaCode,
  });
  throw new GraphQLError(
    schema
      ? "La base de datos no está actualizada. Aplica las migraciones del backend."
      : database
        ? "No se pudo consultar la base de datos para validar el acceso en vivo."
        : "No se pudo validar el acceso administrativo. Revisa el log del backend.",
    { extensions: { code, requestId } },
  );
}

const wsHooks: Pick<
  ServerOptions,
  "onConnect" | "onClose" | "onError" | "onOperation"
> = {
  onConnect: (ctx) => {
    logger.log({
      etapa: "ws_iniciado",
      requestId: idDiagnostico(ctx.connectionParams?.requestId),
    });
  },
  onOperation: (ctx, _id, _payload, _args, resultado) => {
    if (Symbol.asyncIterator in resultado)
      logger.log({
        etapa: "suscripcion_aceptada",
        requestId: idDiagnostico(ctx.connectionParams?.requestId),
      });
  },
  onClose: (ctx, codigo) => {
    logger.log({
      etapa: "ws_cerrado",
      requestId: idDiagnostico(ctx.connectionParams?.requestId),
      codigo,
    });
  },
  onError: (ctx, _id, _payload, errores) => {
    const requestId = idDiagnostico(ctx.connectionParams?.requestId);
    logger.warn({
      etapa: "suscripcion_error",
      requestId,
      codigos: errores.map((error) =>
        typeof error.extensions.code === "string"
          ? error.extensions.code
          : "GRAPHQL_ERROR",
      ),
    });
  },
};

export const opcionesBackOfficeWs = {
  path: "/graphql",
  connectionInitWaitTimeout: 10000,
  ...wsHooks,
};
