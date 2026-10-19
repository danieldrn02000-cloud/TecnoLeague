import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Check, Package, Truck } from "lucide-react";
import { graphql } from "../api";
import { useCarrito } from "../store";
import type { AuthUser, Navegar, Pedido } from "../types";
import { Resumen } from "./Carrito";
import { Vacio } from "../components/ui";
import { guardarIntento, leerIntento } from "../lib/checkout";
import { verificarCheckout } from "../lib/verificar-checkout";
import { FormularioTarjeta } from "../components/tarjeta";

export function Checkout({
  currentUser,
  navegar,
}: {
  currentUser: AuthUser;
  navegar: Navegar;
  completado: (p: Pedido) => void;
}) {
  const { lineas } = useCarrito();
  const [tarjetaValidada, setTarjetaValidada] = useState(false);
  //importe provisional para probar el formualrio.
  const importeReferencia = lineas.reduce(
    (total, linea) => total + linea.producto.precio * linea.cantidad,0).toFixed(2);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const bloqueado = useRef(false);
  const [pendiente, setPendiente] = useState<string | null>(null);
  const [verificando, setVerificando] = useState(true);
  const [falloVerificacion, setFalloVerificacion] = useState(false);
  const [aviso, setAviso] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let activo = true;
    setVerificando(true);
    setFalloVerificacion(false);
    setError("");
    setPendiente(leerIntento(currentUser.id));
    verificarCheckout(currentUser.id)
      .then((resultado) => {
        if (!activo) return;
        setPendiente(resultado.pendiente);
        setAviso(resultado.aviso);
      })
      .catch((error) => {
        if (!activo) return;
        setFalloVerificacion(true);
        setError(
          `No pudimos comprobar tus pagos. ${error instanceof Error ? error.message : "Reintenta la comprobación."}`,
        );
      })
      .finally(() => {
        if (activo) setVerificando(false);
      });
    return () => {
      activo = false;
    };
  }, [currentUser.id, revision]);
  const solicitud = useRef({ contenido: "", clave: "" });
  if (!lineas.length && !pendiente && !verificando && !falloVerificacion)
    return (
      <>
        {aviso && <p role="status">{aviso}</p>}
        <Vacio
          titulo="No hay productos en el carrito"
          texto="Agrega un producto para continuar."
          accion="Ver catálogo"
          onClick={() => navegar({ tipo: "catalogo" })}
        />
      </>
    );

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (
      bloqueado.current ||
      pendiente ||
      verificando ||
      falloVerificacion ||
      !lineas.length
    )
      return;
    bloqueado.current = true;
    setBusy(true);
    setError("");

    const form = new FormData(e.currentTarget);
    const payload = {
      nombre: String(form.get("nombre")).trim(),
      email: String(form.get("email")).trim(),
      direccion: [
        `${String(form.get("calle")).trim()} ${String(form.get("numeroExterior")).trim()}`,
        String(form.get("colonia")).trim(),
        String(form.get("ciudad")).trim(),
        `C.P. ${String(form.get("codigoPostal")).trim()}`,
        form.get("numeroInterior")
          ? `Int. ${String(form.get("numeroInterior")).trim()}`
          : "",
      ]
        .filter(Boolean)
        .join(", "),
      renglones: lineas.map((l) => ({
        productoId: l.producto.id,
        cantidad: l.cantidad,
      })),
    };

    const contenido = JSON.stringify(payload);
    if (solicitud.current.contenido !== contenido)
      solicitud.current = { contenido, clave: crypto.randomUUID() };

    try {
      // La clave también es el ID del intento: sobrevive incluso si se pierde
      // la respuesta después de que el servidor reservó stock.
      const intentoId = solicitud.current.clave;
      guardarIntento(currentUser.id, intentoId);
      const { iniciarPago } = await graphql<{
        iniciarPago: {
          intentoId: string;
          checkoutUrl: string | null;
          estado: string;
          pedidoId: number | null;
        };
      }>(
        `
          mutation Pagar($datos: PedidoInput!) {
            iniciarPago(datos: $datos) {
              intentoId
              checkoutUrl
              estado
              pedidoId
            }
          }
        `,
        { datos: { ...payload, claveSolicitud: intentoId } },
      );
      setPendiente(iniciarPago.intentoId);
      window.location.assign(
        iniciarPago.checkoutUrl ??
          `/pago/retorno?intento=${encodeURIComponent(iniciarPago.intentoId)}`,
      );
    } catch (e) {
      const mensaje =
        e instanceof Error ? e.message : "No se pudo iniciar el pago.";
      setError(mensaje);
      // Mantener la clave ante una respuesta incierta; consultar su existencia
      // antes de permitir otra compra. Un rechazo anterior a crear el intento
      // no debe dejar un ID fantasma bloqueando el checkout.
      setVerificando(true);
      try {
        const resultado = await verificarCheckout(currentUser.id);
        setPendiente(resultado.pendiente);
        setAviso(resultado.aviso);
        setFalloVerificacion(false);
      } catch (error) {
        setPendiente(leerIntento(currentUser.id));
        setFalloVerificacion(true);
        setError(
          `${mensaje} No pudimos verificar el resultado: ${error instanceof Error ? error.message : "reintenta la comprobación."}`,
        );
      } finally {
        setVerificando(false);
      }
    } finally {
      bloqueado.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <button
        className="back-link"
        disabled={busy}
        onClick={() => navegar({ tipo: "carrito" })}
      >
        <ArrowLeft size={16} /> Volver al carrito
      </button>
      <div className="section-heading">
        <div>
          <span className="eyebrow">EL ÚLTIMO PASO</span>
          <h1>Finaliza tu pedido</h1>
          <p>Usa datos ficticios para presentar esta compra de demostración.</p>
        </div>
        <div className="checkout-steps">
          <span>
            <Check size={14} /> Carrito
          </span>
          <span className="accent">02 — Confirmación</span>
        </div>
      </div>
      <form className="compra-grid" onSubmit={enviar}>
        <div className="checkout-form panel">
          <h2>
            <Truck size={22} /> Datos de entrega
          </h2>
          <fieldset disabled={busy}>
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
              Correo electrónico
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={150}
                defaultValue={currentUser.email}
                placeholder="daniel@ejemplo.test"
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

          <div className="pago"></div> 


          {aviso && <p role="status">{aviso}</p>}
          {verificando && (
            <p role="status">Comprobando el estado de tus pagos…</p>
          )}
          {pendiente && (
            <p role="status">
              Conservamos la referencia de un pago. Antes de pagar otra vez,
              <a
                href={`/pago/retorno?intento=${encodeURIComponent(pendiente)}`}
              >
                {" "}
                revisa el resultado de tu pago
              </a>
              .
            </p>
          )}
          {error && (
            <div className="form-error" role="alert">
              {error}
              {falloVerificacion && (
                <button
                  type="button"
                  className="text-btn"
                  disabled={verificando || busy}
                  onClick={() => setRevision((n) => n + 1)}
                >
                  Reintentar comprobación
                </button>
              )}
              <button
                type="button"
                className="text-btn"
                onClick={() => navegar({ tipo: "carrito" })}
              >
                Revisar carrito
              </button>
            </div>
          )}
          {pendiente && !verificando && (
            <button
              type="button"
              className="text-btn"
              disabled={busy}
              onClick={() => setRevision((n) => n + 1)}
            >
              Actualizar estado del pago
            </button>
          )}
        </div>
        <Resumen>
          <button type="submit" className="btn full" disabled>
            Cobro pendiente de conectar
          </button>
          <p className="muted text-sm">
            El servidor valida existencias y calcula el total al confirmar.
          </p>
        </Resumen>

        {!verificando &&
          !falloVerificacion &&
          !pendiente &&
          lineas.length > 0 && (
            <>
              <FormularioTarjeta
                key={importeReferencia}
                importe={importeReferencia}
                onToken={() => {
                  // No guardar ni imprimir el token.
                  // En la etapa 3 se enviará directamente al backend.
                  setTarjetaValidada(true);
                }}
              />

              {tarjetaValidada && (
                <p role="status">
                  Token generado correctamente. Todavía no se ha realizado
                  ningún cobro.
                </p>
              )}
            </>
          )}
      </form>
    </>
  );
}
