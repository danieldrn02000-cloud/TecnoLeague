export class FalloTicket extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly requestId: string,
  ) {
    super(message);
  }
}

export function idBackOffice() {
  // randomUUID no está disponible en algunas conexiones HTTP de la LAN.
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

export function diagnosticoBackOffice(
  etapa: string,
  datos: {
    requestId: string;
    intento?: number;
    codigo?: string | number;
    estado?: number;
    duracionMs?: number;
  },
) {
  // Lista cerrada de datos: nunca registrar tickets, cookies ni respuestas completas.
  console.info("[BackOffice]", { etapa, ...datos });
}

export async function solicitarTicket(signal: AbortSignal, requestId: string) {
  let response: Response;
  try {
    response = await fetch("/api/admin/subscription-ticket", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-BackOffice-Request-Id": requestId,
      },
      cache: "no-store",
      body: "{}",
      signal,
    });
  } catch (error) {
    if (signal.aborted && signal.reason?.name === "TimeoutError") {
      throw new FalloTicket(
        "Astro no respondió a tiempo al solicitar el acceso en vivo.",
        504,
        "TICKET_TIMEOUT",
        requestId,
      );
    }
    if (signal.aborted) throw error;
    throw new FalloTicket(
      "No se pudo solicitar el acceso en vivo a Astro. Comprueba la conexión con la tienda.",
      0,
      "TICKET_NETWORK_ERROR",
      requestId,
    );
  }
  const payload = (await response.json().catch(() => null)) as {
    ticket?: string;
    expiraEn?: string;
    error?: string;
    code?: string;
    requestId?: string;
  } | null;
  if (
    !response.ok ||
    !payload?.ticket ||
    !payload.expiraEn ||
    Date.parse(payload.expiraEn) <= Date.now() ||
    !Number.isFinite(Date.parse(payload.expiraEn))
  ) {
    throw new FalloTicket(
      payload?.error ??
        `El servicio de tickets devolvió una respuesta inválida (HTTP ${response.status}).`,
      response.status,
      payload?.code ?? "TICKET_INVALID_RESPONSE",
      payload?.requestId ?? requestId,
    );
  }
  return payload.ticket;
}

export function codigoCierre(error: unknown): number | undefined {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "number"
  )
    return error.code;
}

export function mensajeCierre(codigo: number | undefined) {
  switch (codigo) {
    case 4408:
      return "NestJS cerró el WebSocket porque no recibió la autenticación inicial a tiempo (4408).";
    case 4504:
      return "NestJS no confirmó la conexión WebSocket dentro del tiempo de espera (4504).";
    case 4500:
      return "El backend encontró un error al iniciar las actualizaciones en vivo (4500). Revisa su log con el identificador de diagnóstico.";
    case 4406:
      return "El backend rechazó el protocolo WebSocket (4406). Debe admitir graphql-transport-ws.";
    case 1006:
      return "La conexión WebSocket se interrumpió sin respuesta (1006). Comprueba que NestJS y el proxy de Astro estén activos.";
    default:
      return `No se pudo mantener la conexión WebSocket${codigo ? ` (código ${codigo})` : ""}. Comprueba el backend y PUBLIC_BACKOFFICE_WS_URL.`;
  }
}

export function mensajeOperacion(code: unknown) {
  switch (code) {
    case "DATABASE_UNAVAILABLE":
      return "El backend no pudo consultar la base de datos para validar el acceso en vivo.";
    case "DATABASE_SCHEMA_MISMATCH":
      return "La base de datos no está actualizada. Aplica las migraciones del backend.";
    case "GRAPHQL_VALIDATION_FAILED":
      return "El backend no reconoce la suscripción administrativa. Comprueba que ejecutas la versión actualizada de NestJS.";
    default:
      return "El backend rechazó la suscripción administrativa. Revisa su log con el identificador de diagnóstico.";
  }
}
