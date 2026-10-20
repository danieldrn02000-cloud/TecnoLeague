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
  const [pausado, setPausado] = useState(false);
  const cuenta = useRef({ id: "", usuarioId, consultas: 0, maximo: 12, ultima: 0 });
  const enCurso = useRef<{ id: string; usuarioId: number; promesa: Promise<EstadoCheckout> } | null>(null);
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
    setPausado(false);
  }, [usuarioId]);

  const recibir = useCallback(async (nuevo: EstadoCheckout | null) => {
    if (!montado.current || usuario.current !== usuarioId) return;
    const previo = actual.current;
    if (nuevo && previo?.intentoId === nuevo.intentoId &&
        ((previo.estado === "CONFIRMADO" && nuevo.estado !== "CONFIRMADO") ||
        (intentoTerminado(previo) && !intentoTerminado(nuevo)))) return;
    // Preparar la reserva y enviar el pago son fases distintas. Un cobro que
    // acaba de empezar debe poder seguirse aunque la reserva ya agotara su tanda.
    if (nuevo && previo?.intentoId === nuevo.intentoId && !previo.operacionId && nuevo.operacionId) {
      cuenta.current.consultas = 0;
      setPausado(false);
      setRevision(n => n + 1);
    }
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

  const revisar = useCallback(() => {
    // Solo una acción explícita del usuario abre otra tanda de consultas.
    cuenta.current.consultas = 0;
    setPausado(false);
    setRevision(n => n + 1);
  }, []);
  const terminado = estado ? intentoTerminado(estado) : false;

  useEffect(() => {
    if (!referencia || terminado) {
      setConsultando(false);
      setPausado(false);
      return;
    }
    if (cuenta.current.id !== referencia || cuenta.current.usuarioId !== usuarioId) {
      cuenta.current = { id: referencia, usuarioId, consultas: 0, maximo: 12, ultima: 0 };
    }
    const control = cuenta.current;
    let activo = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function consultar() {
      const existente = enCurso.current;
      const misma = existente?.id === referencia && existente.usuarioId === usuarioId;
      if (control.consultas >= control.maximo && !misma) {
        if (activo) { setPausado(true); setConsultando(false); }
        return;
      }
      setConsultando(true);
      setPausado(false);
      let continuar = true;
      try {
        let tarea = misma ? existente : null;
        if (!tarea) {
          control.consultas++;
          control.ultima = Date.now();
          tarea = {
            id: referencia!, usuarioId,
            promesa: graphql<{ estadoIntento: EstadoCheckout }>(CONSULTAR_INTENTO, { id: referencia })
              .then(data => data.estadoIntento),
          };
          enCurso.current = tarea;
          const limpiar = () => { if (enCurso.current === tarea) enCurso.current = null; };
          void tarea.promesa.then(limpiar, limpiar);
        }
        const nuevo = await tarea.promesa;
        if (!activo || referenciaActual.current !== referencia) return;
        await recibir(nuevo);
        if (!activo) return;
        setError("");
        continuar = !intentoTerminado(nuevo);
        if (nuevo.autenticacion) control.maximo = 120;
      } catch (e) {
        if (!activo) return;
        setError(e instanceof Error ? e.message : "No pudimos consultar el pago.");
      } finally {
        if (activo) setConsultando(false);
      }
      if (activo && continuar) {
        if (control.consultas < control.maximo) timer = setTimeout(() => void consultar(), 5000);
        else setPausado(true);
      }
    }
    void consultar();
    return () => { activo = false; clearTimeout(timer); };
  }, [referencia, revision, usuarioId, recibir, terminado]);

  useEffect(() => {
    if (!referencia || terminado) return;
    const actualizar = () => {
      const control = cuenta.current;
      if (document.visibilityState === "visible" && !enCurso.current &&
          control.consultas < control.maximo && Date.now() - control.ultima >= 5000) {
        setRevision(n => n + 1);
      }
    };
    window.addEventListener("focus", actualizar);
    document.addEventListener("visibilitychange", actualizar);
    return () => {
      window.removeEventListener("focus", actualizar);
      document.removeEventListener("visibilitychange", actualizar);
    };
  }, [referencia, terminado]);

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
    consultando, pausado, error, recibir, recuperar, revisar, cancelar,
  };
}
