import type { APIRoute } from "astro";
import { randomUUID } from "node:crypto";
import {
  errorStatus,
  mismoOrigen,
  requestBackend,
} from "../../../lib/server/graphql";

export const prerender = false;
const SIN_CACHE = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
};
export type CookiesSesion = {
  get(nombre: string): { value: string } | undefined;
  delete(nombre: string, opciones?: { path?: string }): void;
};

export async function emitirTicketBackOffice(
  request: Request,
  cookies: CookiesSesion,
) {
  const inicio = performance.now();
  const recibido = request.headers.get("x-backoffice-request-id");
  const requestId =
    recibido && /^[a-f0-9-]{16,64}$/i.test(recibido) ? recibido : randomUUID();
  const responder = (body: object, status: number, code: string) => {
    // Lista cerrada: no imprimir cookies, tokens ni respuestas del backend.
    console.info("[BackOffice]", {
      etapa: "ticket_http",
      requestId,
      estado: status,
      codigo: code,
      duracionMs: Math.round(performance.now() - inicio),
    });
    return Response.json(
      { ...body, requestId },
      {
        status,
        headers: { ...SIN_CACHE, "X-BackOffice-Request-Id": requestId },
      },
    );
  };
  if (request.method !== "POST")
    return new Response(null, {
      status: 405,
      headers: { ...SIN_CACHE, Allow: "POST" },
    });
  if (!mismoOrigen(request))
    return responder(
      {
        error:
          "Astro rechazó el origen de la solicitud. Abre el panel desde la misma dirección en la que iniciaste sesión.",
        code: "ORIGIN_FORBIDDEN",
      },
      403,
      "ORIGIN_FORBIDDEN",
    );
  const sesion = cookies.get("tl_session")?.value;
  if (!sesion)
    return responder(
      { error: "Inicia sesión para continuar.", code: "UNAUTHENTICATED" },
      401,
      "UNAUTHENTICATED",
    );
  try {
    const { status, body } = await requestBackend<{
      crearTicketBackOffice: { ticket: string; expiraEn: string };
    }>(
      {
        query:
          "mutation CrearTicketBackOffice { crearTicketBackOffice { ticket expiraEn } }",
      },
      { token: sesion, requestId },
    );
    const ticket = body.data?.crearTicketBackOffice;
    if (
      status < 400 &&
      ticket?.ticket &&
      Number.isFinite(Date.parse(ticket.expiraEn)) &&
      Date.parse(ticket.expiraEn) > Date.now()
    ) {
      return responder(ticket, 200, "TICKET_READY");
    }
    const fallo = body.errors?.[0];
    const backendCode = fallo?.extensions?.code;
    let statusError = errorStatus(fallo, status);
    let code = "BACKEND_INVALID_RESPONSE";
    let error =
      "NestJS devolvió una respuesta inválida al solicitar el acceso en vivo.";
    if (statusError === 401) {
      code = "UNAUTHENTICATED";
      error = "La sesión expiró. Inicia sesión de nuevo.";
      cookies.delete("tl_session", { path: "/" });
    } else if (statusError === 403) {
      code = "FORBIDDEN";
      error = "No tienes permiso para acceder al BackOffice.";
    } else if (backendCode === "DATABASE_UNAVAILABLE") {
      code = backendCode;
      statusError = 503;
      error =
        "NestJS no pudo consultar la base de datos. Revisa PostgreSQL o Neon y la conexión configurada en el backend.";
    } else if (backendCode === "DATABASE_SCHEMA_MISMATCH") {
      code = backendCode;
      statusError = 503;
      error =
        "La base de datos no está actualizada. Ejecuta las migraciones del backend.";
    } else if (backendCode === "GRAPHQL_VALIDATION_FAILED") {
      code = "BACKEND_SCHEMA_MISMATCH";
      statusError = 502;
      error =
        "NestJS no reconoce la operación de tickets. Reinicia el backend con la versión actualizada del proyecto.";
    } else if (
      backendCode === "BACKOFFICE_INTERNAL_ERROR" ||
      backendCode === "INTERNAL_SERVER_ERROR"
    ) {
      code = "BACKEND_INTERNAL_ERROR";
      statusError = 502;
      error =
        "NestJS encontró un error al validar el acceso en vivo. Consulta su log con el identificador de diagnóstico.";
    }
    return responder({ error, code }, statusError, code);
  } catch (error) {
    const timeout =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    const code = timeout ? "BACKEND_TIMEOUT" : "BACKEND_UNREACHABLE";
    return responder(
      {
        error: timeout
          ? "NestJS no respondió a tiempo al solicitar el ticket. Revisa su disponibilidad y la conexión a la base de datos."
          : "Astro no pudo contactar a NestJS. Comprueba que el backend esté iniciado y BACKEND_GRAPHQL_URL sea correcto.",
        code,
      },
      timeout ? 504 : 502,
      code,
    );
  }
}

export const ALL: APIRoute = async ({ request, cookies }) =>
  emitirTicketBackOffice(request, cookies);
