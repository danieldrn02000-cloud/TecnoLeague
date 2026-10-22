import { useEffect, useRef, useState } from "react";
import { createClient, type Client } from "graphql-ws";
import { backOfficeUrl } from "../lib/backoffice-url";
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

async function solicitarTicket(signal: AbortSignal) {
  const response = await fetch("/api/admin/subscription-ticket", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: "{}",
    signal,
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
  const [detalle, setDetalle] = useState("");
  const [intento, setIntento] = useState(0);
  const avisarRef = useRef(avisar);
  useEffect(() => {
    avisarRef.current = avisar;
  }, [avisar]);

  useEffect(() => {
    const abort = new AbortController();
    setDetalle("");
    setEstado("connecting");
    let cliente: Client | undefined;
    let activo = true;
    let terminal = false;
    let conectadoAntes = false;
    let conexionInterrumpida = false;
    let cierresConsecutivos = 0;
    let ticketStatus: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let terminarEspera: (() => void) | undefined;
    let ultimoAviso = 0;
    const eventosPendientes = new Map<string, EventoBackOffice>();
    const vistos = new Map<string, true>();

    const cerrarPorPermiso = (status: number) => {
      if (!activo) return;
      terminal = true;
      setEstado("denied");
      setDetalle(status === 401 ? "La sesión expiró. Inicia sesión de nuevo." : "La cuenta ya no tiene acceso administrativo.");
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
        url: backOfficeUrl(import.meta.env.PUBLIC_BACKOFFICE_WS_URL, import.meta.env.DEV, window.location.href),
        lazy: true,
        retryAttempts: 5,
        retryWait: async (reintentos) => {
          const espera = Math.min(1000 * 2 ** reintentos, 15000);
          await new Promise<void>((resolve) => {
            terminarEspera = resolve;
            retryTimer = setTimeout(resolve, espera);
          });
        },
        shouldRetry: () =>
          activo && !terminal && ticketStatus !== 401 && ticketStatus !== 403,
        connectionParams: async () => {
          try {
            const ticket = await solicitarTicket(AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]));
            ticketStatus = undefined;
            return { ticket };
          } catch (error) {
            if (activo && error instanceof Error) setDetalle(error.message);
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
            setDetalle("");
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
          if (!activo) return;
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
              setDetalle("El backend rechazó la operación de actualización en vivo.");
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
            setDetalle((actual) => actual || "No se pudo conectar con el WebSocket de NestJS. Verifica el servidor y PUBLIC_BACKOFFICE_WS_URL.");
            avisarRef.current("No se pudo mantener la conexión en vivo. Comprueba que NestJS esté activo y que el destino WebSocket sea accesible desde esta computadora.");
          }
        },
        complete: () => {
          if (activo && !terminal) setEstado("disconnected");
        },
      });

      return () => {
        activo = false;
        abort.abort();
        if (timer) clearTimeout(timer);
        if (retryTimer) clearTimeout(retryTimer);
        terminarEspera?.();
        eventosPendientes.clear();
        subscription();
        void cliente?.dispose();
      };
    } catch (error) {
      setEstado("disconnected");
      setDetalle(error instanceof Error ? error.message : "Destino WebSocket inválido.");
      avisarRef.current(
        error instanceof Error ? error.message : "No se pudo configurar el destino WebSocket del BackOffice.",
      );
      return () => {
        activo = false;
        abort.abort();
        if (timer) clearTimeout(timer);
        if (retryTimer) clearTimeout(retryTimer);
        terminarEspera?.();
        void cliente?.dispose();
      };
    }
  }, [intento]);

  return { estado, detalle, reintentar: () => setIntento((actual) => actual + 1) };
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
