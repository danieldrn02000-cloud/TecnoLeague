import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Check, Truck } from "lucide-react";
import { graphql } from "../api";
import { useCarrito } from "../store";
import type { AuthUser, Navegar, Pedido } from "../types";
import { Resumen } from "./Carrito";
import { Vacio } from "../components/ui";
import { guardarIntento, intentoTerminado, leerIntento, puedePagarIntento, PREPARAR_COMPRA, PROCESAR_PAGO, type EstadoCheckout } from "../lib/checkout";
import { verificarCheckout } from "../lib/verificar-checkout";
import { useEstadoPago } from "../lib/use-estado-pago";
import { FormularioTarjeta } from "../components/tarjeta";
import { ResultadoPago } from "../components/ResultadoPago";
import type { TarjetaTokenizada } from "../lib/mercadoPago";

export function Checkout({ currentUser, navegar }: {
  currentUser: AuthUser;
  navegar: Navegar;
  completado: (p: Pedido) => void;
}) {
  const { lineas } = useCarrito();
  const seguimiento = useEstadoPago(currentUser.id);
  const { recibir, recuperar } = seguimiento;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [verificando, setVerificando] = useState(true);
  const [falloVerificacion, setFalloVerificacion] = useState(false);
  const [revision, setRevision] = useState(0);
  const bloqueado = useRef(false);
  const solicitud = useRef({ contenido: "", clave: "" });
  const operacion = useRef({ intentoId: "", clave: "" });
  const estado = seguimiento.estado;

  useEffect(() => {
    let activo = true;
    setVerificando(true);
    setFalloVerificacion(false);
    async function verificar() {
      try {
        const resultado = await verificarCheckout(currentUser.id);
        if (activo) await recibir(resultado.estado);
      } catch {
        if (!activo) return;
        setFalloVerificacion(true);
        setError("No pudimos comprobar tus pagos. Inténtalo de nuevo en unos momentos.");
        const local = leerIntento(currentUser.id);
        if (local) recuperar(local);
      } finally {
        if (activo) setVerificando(false);
      }
    }
    void verificar();
    return () => { activo = false; };
  }, [currentUser.id, recibir, recuperar, revision]);

  useEffect(() => {
    if (estado) {
      setFalloVerificacion(false);
      if (intentoTerminado(estado)) setError("");
      if (puedePagarIntento(estado)) setEnviado(false);
    }
  }, [estado]);

  useEffect(() => {
    const recordar = () => {
      if (!seguimiento.referencia || (estado && intentoTerminado(estado))) return;
      try { sessionStorage.setItem("tl-pantalla-pendiente", "checkout"); } catch { /* El intento sigue recuperable por usuario. */ }
    };
    window.addEventListener("pagehide", recordar);
    return () => window.removeEventListener("pagehide", recordar);
  }, [seguimiento.referencia, estado]);

  async function preparar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (bloqueado.current || verificando || falloVerificacion || seguimiento.referencia || !lineas.length) return;
    const form = new FormData(e.currentTarget);
    const datos = {
      nombre: String(form.get("nombre")).trim(),
      email: currentUser.email,
      direccion: [
        `${String(form.get("calle")).trim()} ${String(form.get("numeroExterior")).trim()}`,
        String(form.get("colonia")).trim(), String(form.get("ciudad")).trim(),
        `C.P. ${String(form.get("codigoPostal")).trim()}`,
        form.get("numeroInterior") ? `Int. ${String(form.get("numeroInterior")).trim()}` : "",
      ].filter(Boolean).join(", "),
      renglones: lineas.map(l => ({ productoId: l.producto.id, cantidad: l.cantidad })),
    };
    const contenido = JSON.stringify(datos);
    if (solicitud.current.contenido !== contenido) solicitud.current = { contenido, clave: crypto.randomUUID() };
    bloqueado.current = true;
    setBusy(true);
    setError("");
    try {
      guardarIntento(currentUser.id, solicitud.current.clave);
      const data = await graphql<{ prepararCompra: EstadoCheckout }>(PREPARAR_COMPRA, {
        datos: { ...datos, claveSolicitud: solicitud.current.clave },
      });
      await recibir(data.prepararCompra);
    } catch {
      setError("No pudimos preparar tu compra. Revisa tus datos y vuelve a intentarlo.");
      try {
        const resultado = await verificarCheckout(currentUser.id);
        await recibir(resultado.estado);
      } catch {
        setFalloVerificacion(true);
        const local = leerIntento(currentUser.id);
        if (local) recuperar(local);
      }
    } finally {
      bloqueado.current = false;
      setBusy(false);
    }
  }

  async function pagar(tarjeta: TarjetaTokenizada) {
    if (bloqueado.current || !estado) return;
    if (!puedePagarIntento(estado)) {
      setError("Necesitamos comprobar tu compra antes de continuar con el pago.");
      recuperar(estado.intentoId);
      return;
    }
    const id = estado.intentoId;
    bloqueado.current = true;
    setBusy(true);
    setEnviado(true);
    setError("");
    if (operacion.current.intentoId !== id) operacion.current = { intentoId: id, clave: crypto.randomUUID() };
    try {
      guardarIntento(currentUser.id, id);
      const data = await graphql<{ procesarPago: EstadoCheckout }>(PROCESAR_PAGO, {
        id,
        pago: {
          claveOperacion: operacion.current.clave,
          token: tarjeta.token,
          metodoPagoId: tarjeta.paymentMethodId,
          tipoMetodoPago: tarjeta.paymentTypeId,
          cuotas: Number(tarjeta.installments),
          email: currentUser.email,
        },
      });
      await recibir(data.procesarPago);
    } catch {
      setError("Todavía no pudimos confirmar tu pago. Estamos revisándolo; espera antes de volver a pagar.");
      recuperar(id);
    } finally {
      // El token vive solo en esta llamada; no se guarda para cobros posteriores.
      bloqueado.current = false;
      setBusy(false);
    }
  }

  async function nuevaCompra() {
    if (busy) return;
    solicitud.current = { contenido: "", clave: "" };
    operacion.current = { intentoId: "", clave: "" };
    setEnviado(false);
    setError("");
    await recibir(null);
    setRevision(n => n + 1);
  }

  return (
    <>
      <button className="back-link" disabled={busy} onClick={() => navegar({ tipo: "carrito" })}>
        <ArrowLeft size={16} /> Volver al carrito
      </button>
      <div className="section-heading">
        <div><span className="eyebrow">FINALIZAR COMPRA</span><h1>Entrega y pago</h1></div>
      </div>
      {verificando && <p role="status">Comprobando el estado de tus pagos…</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {falloVerificacion && <button type="button" className="text-btn" disabled={verificando} onClick={() => setRevision(n => n + 1)}>Reintentar comprobación</button>}
      {estado && <ResultadoPago estado={estado} ocupado={busy || seguimiento.consultando}
        pausado={seguimiento.pausado}
        error={seguimiento.error} onConsultar={seguimiento.revisar} onCancelar={() => void seguimiento.cancelar()}
        onNuevaCompra={() => void nuevaCompra()} onPedidos={() => navegar({ tipo: "pedidos" })} />}
      {!estado && !lineas.length && !verificando && !seguimiento.referencia && (
        <Vacio titulo="No hay productos en el carrito" texto="Agrega un producto para continuar."
          accion="Ver catálogo" onClick={() => navegar({ tipo: "catalogo" })} />
      )}
      {!estado && lineas.length > 0 && (
        <form className="compra-grid" onSubmit={preparar}>
          <div className="checkout-form panel">
            <h2><Truck size={22} /> Datos de entrega</h2>
          <fieldset disabled={busy || verificando || falloVerificacion || !!seguimiento.referencia}>
            <label>
              Nombre completo
              <input
                name="nombre"
                autoComplete="name"
                required
                minLength={2}
                maxLength={120}
                defaultValue={currentUser.nombre}
                placeholder="Ej. Daniel Durán"
              />
            </label>
            <label>
              Calle
              <input
                name="calle"
                autoComplete="address-line1"
                required
                maxLength={200}
                placeholder="Ej. Av. Insurgentes"
              />
            </label>
            <label>
              Número exterior
              <input
                name="numeroExterior"
                type="text"
                inputMode="numeric"
                pattern="[0-9]+"
                autoComplete="address-line2"
                required
                maxLength={10}
                onInput={(event) => {
                  event.currentTarget.value = event.currentTarget.value.replace(
                    /\D/g,
                    "",
                  );
                }}
                placeholder="Ej. 123"
              />
            </label>
            <label>
              Colonia
              <input
                name="colonia"
                autoComplete="address-level3"
                required
                maxLength={120}
                placeholder="Ej. Centro"
              />
            </label>
            <label>
              Ciudad
              <input
                name="ciudad"
                autoComplete="address-level2"
                required
                maxLength={120}
                placeholder="Ej. Ciudad de México"
              />
            </label>
            <label>
              Código postal
              <input
                name="codigoPostal"
                autoComplete="postal-code"
                inputMode="numeric"
                required
                minLength={5}
                maxLength={5}
                pattern="[0-9]{5}"
                title="Ingresa un código postal de 5 dígitos."
                placeholder="Ej. 06000"
              />
            </label>
            <label>
              Número interior (opcional)
              <input
                name="numeroInterior"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="address-line3"
                maxLength={10}
                onInput={(event) => {
                  event.currentTarget.value = event.currentTarget.value.replace(
                    /\D/g,
                    "",
                  );
                }}
                placeholder="Ej. 4"
              />
            </label>
          </fieldset>
          </div>
          <Resumen>
            <button type="submit" className="btn full" disabled={busy || verificando || falloVerificacion || !!seguimiento.referencia}>
              {busy ? "Preparando…" : "Continuar al pago"} <Check size={18} />
            </button>
            <p className="muted text-sm">Revisa tus datos de entrega antes de continuar.</p>
          </Resumen>
        </form>
      )}
      {estado && puedePagarIntento(estado) && !enviado && (
        <div className="compra-grid">
          <FormularioTarjeta key={estado.intentoId} importe={estado.total} procesando={busy} onToken={pagar} />
          <Resumen totalConfirmado={estado.total} />
        </div>
      )}
      {busy && enviado && <p role="status">Procesando el pago. Espera el resultado…</p>}
      {!estado && seguimiento.referencia && (
        <div className="panel resultado-pago">
          <p role="status">Estamos comprobando tu pago. Tu carrito está guardado.</p>
          {seguimiento.error && <p role="alert">{seguimiento.error}</p>}
          <button type="button" className="text-btn" disabled={seguimiento.consultando} onClick={seguimiento.revisar}>Consultar estado</button>
        </div>
      )}
    </>
  );
}
