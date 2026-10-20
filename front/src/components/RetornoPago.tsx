import { useEffect } from "react";
import { useEstadoPago } from "../lib/use-estado-pago";
import { ResultadoPago } from "./ResultadoPago";

export function RetornoPago({
  intentoId,
  usuarioId,
}: {
  intentoId: string;
  usuarioId: number;
}) {
  const seguimiento = useEstadoPago(usuarioId);
  const { recuperar } = seguimiento;
  useEffect(() => {
    recuperar(intentoId);
  }, [intentoId, recuperar]);

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
          ocupado={seguimiento.consultando}
          pausado={seguimiento.pausado}
          error={seguimiento.error}
          onConsultar={seguimiento.revisar}
          onCancelar={() => void seguimiento.cancelar()}
          onNuevaCompra={() => volver("carrito")}
          onPedidos={() => volver("pedidos")}
        />
      ) : (
        <section className="resultado-pago panel">
          <h1>Consultar el pago</h1>
          <p role="status">Estamos verificando el intento de compra.</p>
          {seguimiento.error && <p role="alert">{seguimiento.error}</p>}
          <button
            type="button"
            className="btn"
            disabled={seguimiento.consultando}
            onClick={seguimiento.revisar}
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
