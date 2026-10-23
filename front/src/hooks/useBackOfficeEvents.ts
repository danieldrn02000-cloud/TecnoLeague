import { useEffect, useRef, useState } from "react";
import { createClient, type Client } from "graphql-ws";
import { backOfficeUrl } from "../lib/backoffice-url";
import {
  codigoCierre,
  diagnosticoBackOffice,
  FalloTicket,
  idBackOffice,
  mensajeCierre,
  mensajeOperacion,
  solicitarTicket,
} from "../lib/backoffice-connection";
//Este archivo centraliza una conexion por panel motnado.
//Solicitud del ticket
//Escucha de backOfficeActualizado
//Reconexion con espera progresiva
//Agrupacion de eventos durante 200ms
export type EntidadBackOffice =
  "PEDIDO" | "PRODUCTO" | "INVENTARIO" | "CATEGORIA" | "PAGO";

type EventoBackOffice = {
  eventoId: string;
  entidad: EntidadBackOffice;
  entidadId: number;
  accion: string;
  ocurridoEn: string;
};

type EstadoConexion =
  "connecting" | "connected" | "reconnecting" | "disconnected" | "denied";

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
    let activo = true;
    let terminal = false;
    let generacion = 0;
    let cliente: Client | undefined;
    let cancelar: (() => void) | undefined;
    let conectadoAntes = false;
    let conexionInterrumpida = false;
    let reintentos = 0;
    let numeroIntento = 0;
    let requestId = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let ultimoAviso = 0;
    const eventosPendientes = new Map<string, EventoBackOffice>();
    const vistos = new Map<string, true>();
    setDetalle("");
    setEstado("connecting");

    const cerrarConexion = () => {
      cancelar?.();
      cancelar = undefined;
      void cliente?.dispose();
      cliente = undefined;
    };
    const cerrarPorPermiso = (status: number, mensaje?: string) => {
      if (!activo) return;
      terminal = true;
      setEstado("denied");
      setDetalle(
        `${mensaje || (status === 401 ? "La sesión expiró. Inicia sesión de nuevo." : "La cuenta ya no tiene acceso administrativo.")} Diagnóstico: ${requestId}.`,
      );
      if (status === 401) window.dispatchEvent(new Event("tl-sesion-invalida"));
      else avisarRef.current("Se perdió el acceso administrativo.");
      cerrarConexion();
    };
    const mostrarErrorOperacion = (
      errores: readonly { extensions?: { code?: unknown } }[],
    ) => {
      const code = errores.find(
        (e) =>
          e.extensions?.code === "UNAUTHENTICATED" ||
          e.extensions?.code === "FORBIDDEN",
      )?.extensions?.code;
      if (code === "UNAUTHENTICATED") cerrarPorPermiso(401);
      else if (code === "FORBIDDEN") cerrarPorPermiso(403);
      else {
        terminal = true;
        setEstado("disconnected");
        const operationCode = errores[0]?.extensions?.code;
        setDetalle(
          `${mensajeOperacion(operationCode)} Diagnóstico: ${requestId}.`,
        );
        diagnosticoBackOffice("suscripcion_error", {
          requestId,
          codigo:
            typeof operationCode === "string" ? operationCode : "GRAPHQL_ERROR",
        });
        cerrarConexion();
      }
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
    const programarReintento = (mensaje: string) => {
      if (!activo || terminal || retryTimer) return;
      conexionInterrumpida = true;
      setDetalle(`${mensaje} Diagnóstico: ${requestId}.`);
      if (reintentos >= 5) {
        terminal = true;
        setEstado("disconnected");
        return;
      }
      setEstado("reconnecting");
      const espera = Math.min(1000 * 2 ** reintentos++, 15000);
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        void conectar();
      }, espera);
    };

    let destino: string;
    try {
      destino = backOfficeUrl(
        import.meta.env.PUBLIC_BACKOFFICE_WS_URL,
        import.meta.env.DEV,
        window.location.href,
      );
    } catch (error) {
      setEstado("disconnected");
      setDetalle(
        error instanceof Error ? error.message : "Destino WebSocket inválido.",
      );
      return () => {
        activo = false;
        abort.abort();
      };
    }

    async function conectar() {
      const actual = ++generacion;
      const vigente = () => activo && actual === generacion;
      cerrarConexion();
      requestId = idBackOffice();
      numeroIntento += 1;
      setEstado(
        conectadoAntes || reintentos > 0 ? "reconnecting" : "connecting",
      );
      const inicio = performance.now();
      try {
        // Obtener el ticket ANTES de construir el socket en cada intento.
        // Gestionar aquí los fallos evita rechazos sin manejar en la URL async
        // de graphql-ws y permite reintentar aunque el ticket HTTP falle.
        const ticket = await solicitarTicket(
          AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
          requestId,
        );
        if (!vigente()) return;
        diagnosticoBackOffice("ticket_obtenido", {
          requestId,
          intento: numeroIntento,
          duracionMs: Math.round(performance.now() - inicio),
        });
        cliente = createClient({
          url: destino,
          lazy: true,
          retryAttempts: 0, // Cada reconexión pasa por conectar y obtiene otro ticket.
          connectionAckWaitTimeout: 10000,
          connectionParams: { ticket, requestId },
          on: {
            connected: () => {
              if (!vigente() || terminal) return;
              reintentos = 0;
              setEstado("connected");
              setDetalle("");
              diagnosticoBackOffice("ws_conectado", {
                requestId,
                intento: numeroIntento,
              });
              if (conectadoAntes || conexionInterrumpida) publicarReconectado();
              conectadoAntes = true;
              conexionInterrumpida = false;
            },
            closed: (evento) => {
              if (!vigente() || terminal) return;
              const codigo = codigoCierre(evento);
              diagnosticoBackOffice("ws_cerrado", {
                requestId,
                codigo,
                intento: numeroIntento,
              });
              programarReintento(mensajeCierre(codigo));
              // También los cierres 1000 inesperados necesitan un ticket nuevo.
              cerrarConexion();
            },
          },
        });
        cancelar = cliente.subscribe<{
          backOfficeActualizado: EventoBackOffice;
        }>(
          { query: OPERACION },
          {
            next: (resultado) => {
              if (!vigente() || terminal) return;
              if (resultado.errors?.length) {
                mostrarErrorOperacion(resultado.errors);
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
            error: (error) => {
              if (!vigente() || terminal) return;
              if (Array.isArray(error)) mostrarErrorOperacion(error);
              else {
                const codigo = codigoCierre(error);
                diagnosticoBackOffice("ws_error", {
                  requestId,
                  codigo: codigo ?? "WEBSOCKET_ERROR",
                  intento: numeroIntento,
                });
                programarReintento(mensajeCierre(codigo));
              }
            },
            complete: () => {
              if (!vigente() || terminal || retryTimer) return;
              setEstado("disconnected");
              setDetalle(
                `El backend finalizó la suscripción administrativa. Diagnóstico: ${requestId}.`,
              );
            },
          },
        );
      } catch (error) {
        if (!vigente()) return;
        const mensaje =
          error instanceof FalloTicket
            ? error.message
            : "No se pudo completar el inicio de la conexión en vivo. Comprueba el backend y el tiempo de espera del ticket.";
        diagnosticoBackOffice("inicio_error", {
          requestId,
          intento: numeroIntento,
          codigo:
            error instanceof FalloTicket
              ? error.code
              : "CONNECTION_START_ERROR",
          estado: error instanceof FalloTicket ? error.status : undefined,
          duracionMs: Math.round(performance.now() - inicio),
        });
        if (
          error instanceof FalloTicket &&
          (error.status === 401 ||
            (error.status === 403 && error.code !== "ORIGIN_FORBIDDEN"))
        ) {
          cerrarPorPermiso(error.status, error.message);
        } else if (
          error instanceof FalloTicket &&
          error.status >= 400 &&
          error.status < 500
        ) {
          terminal = true;
          setEstado("disconnected");
          setDetalle(`${mensaje} Diagnóstico: ${requestId}.`);
        } else programarReintento(mensaje);
      }
    }
    void conectar();
    return () => {
      activo = false;
      generacion += 1;
      abort.abort();
      if (timer) clearTimeout(timer);
      if (retryTimer) clearTimeout(retryTimer);
      eventosPendientes.clear();
      cerrarConexion();
    };
  }, [intento]);

  return {
    estado,
    detalle,
    reintentar: () => setIntento((actual) => actual + 1),
  };
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
