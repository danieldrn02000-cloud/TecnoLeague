import { useState } from "react";
import { ArrowRight, Check, ChevronDown, Package } from "lucide-react";
import { dinero, graphql, PEDIDO, useQuery } from "../api";
import { Cargando, ErrorCarga, Imagen, Vacio } from "../components/ui";
import type { Navegar, Pedido } from "../types";
export function Pedidos({ navegar }: { navegar: Navegar }) {
  const { data, loading, error, retry } = useQuery<{ pedidos: Pedido[] }>(
    `query Historial{pedidos{${PEDIDO}}}`,
  );
  const [abierto, setAbierto] = useState<number | null>(null);
  const [pagando, setPagando] = useState<number | null>(null);
  const [errorPago, setErrorPago] = useState("");

  async function continuarPago(pedidoId: number) {
    setPagando(pedidoId);
    setErrorPago("");
    try {
      const { iniciarPago } = await graphql<{
        iniciarPago: { checkoutUrl: string };
      }>(
        `mutation Pagar($pedidoId:Int!){iniciarPago(pedidoId:$pedidoId){checkoutUrl}}`,
        { pedidoId },
      );
      window.location.assign(iniciarPago.checkoutUrl);
    } catch (e) {
      setErrorPago(
        e instanceof Error ? e.message : "No se pudo continuar con el pago.",
      );
      setPagando(null);
    }
  }

  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">HISTORIAL</span>
          <h1>Mis pedidos</h1>
          <p>Consulta los detalles de tus compras de demostración.</p>
        </div>
        <button
          className="text-btn"
          onClick={() => navegar({ tipo: "catalogo" })}
        >
          Seguir comprando <ArrowRight size={17} />
        </button>
      </div>
      {error ? (
        <ErrorCarga mensaje={error} reintentar={retry} />
      ) : loading ? (
        <Cargando />
      ) : !data?.pedidos.length ? (
        <Vacio
          titulo="Todavía no tienes pedidos"
          texto="Tu primera compra aparecerá aquí cuando la confirmes."
          accion="Explorar catálogo"
          onClick={() => navegar({ tipo: "catalogo" })}
        />
      ) : (
        <div className="pedidos-lista">
          {errorPago && (
            <p className="auth-error" role="alert">
              {errorPago}
            </p>
          )}
          {data.pedidos.map((p) => (
            <article className="pedido panel" key={p.id}>
              <div className="pedido-head">
                <div>
                  <h2>Pedido {p.folio}</h2>
                  <time dateTime={p.fecha}>
                    {new Date(p.fecha).toLocaleDateString("es-MX", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </time>
                </div>
                <span className="stock-text">
                  <Check size={16} />
                  {
                    (
                      {
                        PENDIENTE: "Pendiente de pago",
                        PAGADO: "Pagado",
                        ENVIADO: "Enviado",
                        ENTREGADO: "Entregado",
                        CANCELADO: "Cancelado",
                      } as Record<string, string>
                    )[p.status]
                  }
                </span>
              </div>
              <div className="pedido-resumen">
                <div className="pedido-icon">
                  <Package size={24} />
                </div>
                <div>
                  <strong>
                    {p.detalles.reduce((s, d) => s + d.cantidad, 0)} artículos
                  </strong>
                  <p>
                    {p.metodoPago === "MERCADO_PAGO"
                      ? "Mercado Pago"
                      : "Pago al recibir"}
                  </p>
                </div>
                <strong className="pedido-total">
                  {dinero(p.total)} <small>MXN</small>
                </strong>
                <button
                  className="text-btn"
                  aria-expanded={abierto === p.id}
                  onClick={() => setAbierto(abierto === p.id ? null : p.id)}
                >
                  {abierto === p.id ? "Ocultar" : "Ver detalles"}
                  <ChevronDown size={17} />
                </button>
              </div>
              {abierto === p.id && (
                <div className="pedido-detalles">
                  {p.detalles.map((d) => (
                    <div key={d.id}>
                      <Imagen producto={d.producto} />
                      <span>
                        <strong>{d.nombreProducto}</strong>
                        <small>
                          {d.cantidad} × {dinero(d.precioUnitario)}
                        </small>
                      </span>
                      <strong>{dinero(d.subtotal)}</strong>
                    </div>
                  ))}
                  <p>
                    Entrega para <strong>{p.nombre}</strong> · {p.direccion}
                  </p>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </>
  );
}
