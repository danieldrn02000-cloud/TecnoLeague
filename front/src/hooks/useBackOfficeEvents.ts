import { useEffect, useRef, useState } from "react";
import { createClient, type Client } from "graphql-ws";
//Este archivo centraliza una conexion por panel motnado.
//Solicitud del ticket
//Escucha de backOfficeActualizado
//Reconexion con espera progresiva
//Agrupacion de eventos durante 200ms
export type EntidadBackOffice =
  | "PEDIDO"
  | "PRODUCTO"
  | "INVENTARIO"
  | "CATEGORIA"
  | "PAGO";

type EventoBackOffice = {
  eventoId: string;
  entidad: EntidadBackOffice;
  entidadId: number;
  accion: string;
  ocurridoEn: string;
};

type EstadoConexion =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "denied";

const EVENTO_REFRESH = "tl-backoffice-refresh";
const EVENTO_RECONNECTED = "tl-backoffice-reconnected";
const OPERACION = `subscription BackOfficeEnVivo {
  backOfficeActualizado {
    eventoId
    entidad
    entidadId
    accion
    ocurridoEn
  }
}`;

class FalloTicket extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function solicitarTicket() {
  const response = await fetch("/api/admin/subscription-ticket", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: "{}",
  });
  const payload = (await response.json().catch(() => null)) as
    | { ticket?: string; expiraEn?: string; error?: string }
    | null;
  if (!response.ok || !payload?.ticket || !payload.expiraEn) {
    throw new FalloTicket(
      payload?.error ?? "No se pudo iniciar la conexión administrativa.",
      response.status,
    );
  }
  return payload.ticket;
}

function urlWebSocket() {
  const configured = import.meta.env.PUBLIC_BACKOFFICE_WS_URL;
  if (!configured && import.meta.env.DEV) {
    return "ws://127.0.0.1:4000/graphql";
  }
  if (!configured) {
    throw new Error(
      "Falta configurar PUBLIC_BACKOFFICE_WS_URL para el BackOffice.",
    );
  }
  const url = new URL(configured);
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("PUBLIC_BACKOFFICE_WS_URL debe usar ws:// o wss://.");
  }
  if (window.location.protocol === "https:" && url.protocol !== "wss:") {
    throw new Error("El BackOffice requiere wss:// cuando el sitio usa HTTPS.");
  }
  if (
    !import.meta.env.DEV &&
    ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
  ) {
    throw new Error(
      "PUBLIC_BACKOFFICE_WS_URL debe apuntar al backend público en producción.",
    );
  }
  return url.toString();
}

function publicarEventos(eventos: EventoBackOffice[]) {
  window.dispatchEvent(
    new CustomEvent<EventoBackOffice[]>(EVENTO_REFRESH, { detail: eventos }),
  );
}

function publicarReconectado() {
  window.dispatchEvent(new Event(EVENTO_RECONNECTED));
}

export function useBackOfficeEvents(avisar: (mensaje: string) => void) {
  const [estado, setEstado] = useState<EstadoConexion>("connecting");
  const avisarRef = useRef(avisar);
  useEffect(() => {
    avisarRef.current = avisar;
  }, [avisar]);

  useEffect(() => {
    let cliente: Client | undefined;
    let activo = true;
    let terminal = false;
    let conectadoAntes = false;
    let conexionInterrumpida = false;
    let cierresConsecutivos = 0;
    let ticketStatus: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ultimoAviso = 0;
    const eventosPendientes = new Map<string, EventoBackOffice>();
    const vistos = new Map<string, true>();

    const cerrarPorPermiso = (status: number) => {
      terminal = true;
      setEstado("denied");
      if (status === 401) {
        window.dispatchEvent(new Event("tl-sesion-invalida"));
      } else {
        avisarRef.current("Se perdió el acceso administrativo.");
      }
      void cliente?.dispose();
    };

    const programarRefresh = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        const eventos = [...eventosPendientes.values()];
        eventosPendientes.clear();
        if (!eventos.length || !activo) return;
        publicarEventos(eventos);
        if (Date.now() - ultimoAviso >= 4000) {
          ultimoAviso = Date.now();
          avisarRef.current("Los datos visibles se actualizaron.");
        }
      }, 200);
    };

    try {
      cliente = createClient({
        url: urlWebSocket(),
        lazy: true,
        retryAttempts: 5,
        retryWait: async (reintentos) => {
          const espera = Math.min(1000 * 2 ** reintentos, 15000);
          await new Promise((resolve) => setTimeout(resolve, espera));
        },
        shouldRetry: () =>
          !terminal && ticketStatus !== 401 && ticketStatus !== 403,
        connectionParams: async () => {
          try {
            const ticket = await solicitarTicket();
            ticketStatus = undefined;
            return { ticket };
          } catch (error) {
            if (error instanceof FalloTicket) {
              ticketStatus = error.status;
              if (error.status === 401 || error.status === 403) {
                cerrarPorPermiso(error.status);
              }
            }
            throw error;
          }
        },
        on: {
          connecting: () => {
            if (activo && !terminal) {
              setEstado(conectadoAntes ? "reconnecting" : "connecting");
            }
          },
          connected: () => {
            if (!activo || terminal) return;
            cierresConsecutivos = 0;
            setEstado("connected");
            if (conectadoAntes || conexionInterrumpida) {
              publicarReconectado();
            }
            conexionInterrumpida = false;
            conectadoAntes = true;
          },
          closed: () => {
            if (!activo || terminal) return;
            conexionInterrumpida = true;
            cierresConsecutivos += 1;
            setEstado(cierresConsecutivos >= 5 ? "disconnected" : "reconnecting");
          },
          error: () => {
            if (activo && !terminal) {
              conexionInterrumpida = true;
              setEstado("reconnecting");
            }
          },
        },
      });

      const subscription = cliente.subscribe<
        { backOfficeActualizado: EventoBackOffice },
        Record<string, never>
      >({ query: OPERACION }, {
        next: (resultado) => {
          if (resultado.errors?.length) {
            const code = resultado.errors.find(
              (error) =>
                error.extensions?.code === "UNAUTHENTICATED" ||
                error.extensions?.code === "FORBIDDEN",
            )?.extensions?.code;
            if (code === "UNAUTHENTICATED") cerrarPorPermiso(401);
            else if (code === "FORBIDDEN") cerrarPorPermiso(403);
            else {
              setEstado("disconnected");
              avisarRef.current(
                "No se pudo procesar una actualización del BackOffice.",
              );
            }
            return;
          }
          const evento = resultado.data?.backOfficeActualizado;
          if (!evento || vistos.has(evento.eventoId)) return;
          vistos.set(evento.eventoId, true);
          if (vistos.size > 500) {
            const primero = vistos.keys().next().value;
            if (primero) vistos.delete(primero);
          }
          eventosPendientes.set(evento.eventoId, evento);
          programarRefresh();
        },
        error: (errores) => {
          const code = Array.isArray(errores)
            ? errores.find(
                (error) =>
                  error.extensions?.code === "UNAUTHENTICATED" ||
                  error.extensions?.code === "FORBIDDEN",
              )?.extensions?.code
            : undefined;
          if (code === "UNAUTHENTICATED") cerrarPorPermiso(401);
          else if (code === "FORBIDDEN") cerrarPorPermiso(403);
          else if (activo) {
            setEstado("disconnected");
            avisarRef.current("La suscripción administrativa encontró un error.");
          }
        },
        complete: () => {
          if (activo && !terminal) setEstado("disconnected");
        },
      });

      return () => {
        activo = false;
        if (timer) clearTimeout(timer);
        eventosPendientes.clear();
        subscription();
        void cliente?.dispose();
      };
    } catch {
      setEstado("disconnected");
      avisarRef.current(
        "No se pudo configurar el destino WebSocket del BackOffice.",
      );
      return () => {
        activo = false;
        if (timer) clearTimeout(timer);
        void cliente?.dispose();
      };
    }
  }, []);

  return estado;
}

export function useBackOfficeRefresh(
  retry: () => void,
  entidades: readonly EntidadBackOffice[],
  onChanged?: (eventos: EventoBackOffice[]) => void,
) {
  const claveEntidades = entidades.join(",");
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  useEffect(() => {
    const esperadas = new Set(claveEntidades.split(","));
    const actualizar = (evento: Event) => {
      const recibidas = (evento as CustomEvent<EventoBackOffice[]>).detail;
      const relevantes = recibidas?.filter((item) =>
        esperadas.has(item.entidad),
      );
      if (relevantes?.length) {
        retry();
        onChangedRef.current?.(relevantes);
      }
    };
    window.addEventListener(EVENTO_REFRESH, actualizar);
    window.addEventListener(EVENTO_RECONNECTED, retry);
    return () => {
      window.removeEventListener(EVENTO_REFRESH, actualizar);
      window.removeEventListener(EVENTO_RECONNECTED, retry);
    };
  }, [claveEntidades, retry]);
}
