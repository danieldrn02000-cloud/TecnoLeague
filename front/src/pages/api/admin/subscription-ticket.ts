
//Astro lee la cokie en el srevidor, solicita el ticket al backend y lo entrega al navegador sin revelar el JWT original
import type { APIRoute } from "astro";
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
  if (request.method !== "POST") {
    return new Response(null, {
      status: 405,
      headers: { ...SIN_CACHE, Allow: "POST" },
    });
  }
  if (!mismoOrigen(request)) {
    return Response.json(
      { error: "Solicitud no permitida." },
      { status: 403, headers: SIN_CACHE },
    );
  }

  const sesion = cookies.get("tl_session")?.value;
  if (!sesion) {
    return Response.json(
      { error: "Inicia sesión para continuar." },
      { status: 401, headers: SIN_CACHE },
    );
  }

  try {
    const { status, body } = await requestBackend<{
      crearTicketBackOffice: { ticket: string; expiraEn: string };
    }>(
      {
        query:
          "mutation CrearTicketBackOffice { crearTicketBackOffice { ticket expiraEn } }",
      },
      { token: sesion },
    );

    const ticket = body.data?.crearTicketBackOffice;
    if (ticket?.ticket && ticket.expiraEn) {
      return Response.json(ticket, { headers: SIN_CACHE });
    }

    const fallo = body.errors?.[0];
    const statusError = errorStatus(fallo, status);
    const mensaje =
      statusError === 401
        ? "La sesión expiró. Inicia sesión de nuevo."
        : statusError === 403
          ? "No tienes permiso para acceder al BackOffice."
          : "No se pudo iniciar la conexión administrativa.";
    if (statusError === 401) cookies.delete("tl_session", { path: "/" });
    return Response.json(
      { error: mensaje },
      { status: statusError, headers: SIN_CACHE },
    );
  } catch {
    return Response.json(
      { error: "No se pudo contactar al servicio administrativo." },
      { status: 502, headers: SIN_CACHE },
    );
  }
};

export const ALL: APIRoute = async ({ request, cookies }) =>
  emitirTicketBackOffice(request, cookies);
