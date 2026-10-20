import { useCallback, useEffect, useRef, useState } from "react";
import { graphql } from "../api";
import {
  aplicarCompraConfirmada, CANCELAR_INTENTO, CONSULTAR_INTENTO,
  guardarIntento, intentoTerminado, olvidarIntento, type EstadoCheckout,
} from "./checkout";

// Comparte recuperación, consulta y aplicación del carrito entre checkout y retorno.
export function useEstadoPago(usuarioId: number) {
  const [estado, setEstado] = useState<EstadoCheckout | null>(null);
  const [referencia, setReferencia] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [consultando, setConsultando] = useState(false);
  const [error, setError] = useState("");
  const actual = useRef<EstadoCheckout | null>(null);
  const referenciaActual = useRef<string | null>(null);
  const propietario = useRef(usuarioId);
  const usuario = useRef(usuarioId);
  const montado = useRef(true);
  usuario.current = usuarioId;

  useEffect(() => {
    montado.current = true;
    return () => { montado.current = false; };
  }, []);

  useEffect(() => {
    actual.current = null;
    referenciaActual.current = null;
    propietario.current = usuarioId;
    setEstado(null);
    setReferencia(null);
    setError("");
  }, [usuarioId]);

  const recibir = useCallback(async (nuevo: EstadoCheckout | null) => {
    if (!montado.current || usuario.current !== usuarioId) return;
    const previo = actual.current;
    if (nuevo && previo?.intentoId === nuevo.intentoId &&
        ((previo.estado === "CONFIRMADO" && nuevo.estado !== "CONFIRMADO") ||
        (intentoTerminado(previo) && !intentoTerminado(nuevo)))) return;
    actual.current = nuevo;
    referenciaActual.current = nuevo?.intentoId ?? null;
    propietario.current = usuarioId;
    setEstado(nuevo);
    setReferencia(nuevo?.intentoId ?? null);
    if (!nuevo) return;
    if (nuevo.estado === "CONFIRMADO") await aplicarCompraConfirmada(usuarioId, nuevo);
    else if (intentoTerminado(nuevo)) olvidarIntento(usuarioId, nuevo.intentoId);
    else guardarIntento(usuarioId, nuevo.intentoId);
  }, [usuarioId]);

  const recuperar = useCallback((id: string) => {
    referenciaActual.current = id;
    if (actual.current?.intentoId !== id) {
      actual.current = null;
      setEstado(null);
    }
    setReferencia(id);
    setRevision(n => n + 1);
  }, []);

  const revisar = useCallback(() => setRevision(n => n + 1), []);
  const terminado = estado ? intentoTerminado(estado) : false;

  useEffect(() => {
    if (!referencia) return;
    let activo = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let consultas = 0;
    let maxConsultas = 12;
    async function consultar() {
      setConsultando(true);
      let continuar = true;
      try {
        const data = await graphql<{ estadoIntento: EstadoCheckout }>(CONSULTAR_INTENTO, { id: referencia });
        if (!activo || referenciaActual.current !== referencia) return;
        await recibir(data.estadoIntento);
        if (!activo) return;
        setError("");
        continuar = !intentoTerminado(data.estadoIntento);
        if (data.estadoIntento.autenticacion) maxConsultas = 120;
      } catch (e) {
        if (!activo) return;
        setError(e instanceof Error ? e.message : "No pudimos consultar el pago.");
      } finally {
        if (activo) setConsultando(false);
      }
      if (activo && continuar && ++consultas < maxConsultas) {
        timer = setTimeout(() => void consultar(), 5000);
      }
    }
    void consultar();
    return () => { activo = false; clearTimeout(timer); };
  }, [referencia, revision, usuarioId, recibir, terminado]);

  useEffect(() => {
    if (!referencia || terminado) return;
    const actualizar = () => { if (document.visibilityState === "visible") revisar(); };
    window.addEventListener("focus", actualizar);
    document.addEventListener("visibilitychange", actualizar);
    return () => {
      window.removeEventListener("focus", actualizar);
      document.removeEventListener("visibilitychange", actualizar);
    };
  }, [referencia, terminado, revisar]);

  const cancelar = useCallback(async () => {
    if (!referencia) return;
    setConsultando(true);
    setError("");
    try {
      const data = await graphql<{ cancelarIntento: EstadoCheckout }>(CANCELAR_INTENTO, { id: referencia });
      await recibir(data.cancelarIntento);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cancelar. Consulta el estado antes de pagar otra vez.");
    } finally {
      setConsultando(false);
    }
  }, [referencia, recibir]);

  return {
    estado: propietario.current === usuarioId ? estado : null,
    referencia: propietario.current === usuarioId ? referencia : null,
    consultando, error, recibir, recuperar, revisar, cancelar,
  };
}
