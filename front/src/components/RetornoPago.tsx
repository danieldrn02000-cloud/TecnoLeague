import { useEffect, useState } from "react";
import { graphql } from "../api";
import { CANCELAR_INTENTO, CONFIRMAR_PAYPAL, type EstadoCheckout } from "../lib/checkout";
import { useEstadoPago } from "../lib/use-estado-pago";
import { ResultadoPago } from "./ResultadoPago";

export function RetornoPago({
  intentoId,
  usuarioId,
  paypal,
}: {
  intentoId: string;
  usuarioId: number;
  paypal?: "aprobado" | "cancelado";
}) {
  const seguimiento = useEstadoPago(usuarioId);
  const { recuperar, recibir } = seguimiento;
  const [revision, setRevision] = useState(0);
  const [confirmando, setConfirmando] = useState(false);
  useEffect(() => {
    if (!paypal) { recuperar(intentoId); return; }
    let activo = true;
    setConfirmando(true);
    void graphql<{ confirmarPagoPayPal?: EstadoCheckout; cancelarIntento?: EstadoCheckout }>(
      paypal === "aprobado" ? CONFIRMAR_PAYPAL : CANCELAR_INTENTO, { id: intentoId },
    ).then(async data => {
      if (!activo) return;
      const estado = data.confirmarPagoPayPal ?? data.cancelarIntento;
      if (estado) await recibir(estado); else recuperar(intentoId);
    }).catch(() => { if (activo) recuperar(intentoId); })
      .finally(() => { if (activo) setConfirmando(false); });
    return () => { activo = false; };
  }, [intentoId, recuperar, recibir, paypal, revision]);

  const consultar = () => paypal === "aprobado" ? setRevision(n => n + 1) : seguimiento.revisar();

  function volver(pantalla: "pedidos" | "carrito") {
    try {
      sessionStorage.setItem("tl-pantalla-pendiente", pantalla);
    } catch {
      /* Navegación normal disponible. */
    }
    window.location.assign("/");
  }

  return (
    <main className="retorno-pago">
      {seguimiento.estado ? (
        <ResultadoPago
          estado={seguimiento.estado}
          ocupado={confirmando || seguimiento.consultando}
          pausado={seguimiento.pausado}
          error={seguimiento.error}
          onConsultar={consultar}
          onCancelar={() => void seguimiento.cancelar()}
          onNuevaCompra={() => volver("carrito")}
          onPedidos={() => volver("pedidos")}
        />
      ) : (
        <section className="resultado-pago panel">
          <h1>Consultar el pago</h1>
          <p role="status">Estamos consultando el resultado de tu pago.</p>
          {seguimiento.error && <p role="alert">{seguimiento.error}</p>}
          <button
            type="button"
            className="btn"
            disabled={confirmando || seguimiento.consultando}
            onClick={consultar}
          >
            Consultar de nuevo
          </button>
        </section>
      )}
      <a
        href="/"
        onClick={() => {
          try {
            sessionStorage.setItem("tl-pantalla-pendiente", "carrito");
          } catch {
            /* Navegación normal disponible. */
          }
        }}
      >
        Volver a la tienda
      </a>
    </main>
  );
}
