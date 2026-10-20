import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ShieldCheck, Trash2 } from "lucide-react";
import { dinero, graphql, PRODUCTO } from "../api";
import { Cantidad, ErrorCarga, Imagen, Vacio } from "../components/ui";
import { useCarrito } from "../store";
import type { Navegar, Producto } from "../types";
export function Resumen({ children, totalConfirmado }: { children?: React.ReactNode; totalConfirmado?: string }) {
  const { total, unidades } = useCarrito();
  const importe = totalConfirmado === undefined ? total : Number(totalConfirmado);
  return (
    <aside className="resumen panel">
      <span className="eyebrow">TU SELECCIÓN</span>
      <h2>Resumen del pedido</h2>
      <div>
        <span>Subtotal ({unidades} artículos)</span>
        <strong>{dinero(importe)}</strong>
      </div>
      <div>
        <span>Envío</span>
        <strong className="accent">Sin costo</strong>
      </div>
      <div className="resumen-total">
        <span>Total</span>
        <strong>
          {dinero(importe)} <small>MXN</small>
        </strong>
      </div>
      {children}
      <p className="resumen-nota">
        <ShieldCheck size={18} /> Pago procesado por Mercado Pago. Consulta su resultado antes de volver a pagar.
      </p>
    </aside>
  );
}
export function Carrito({ navegar }: { navegar: Navegar }) {
  const { lineas, cambiar, quitar, sincronizar } = useCarrito();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const initial = useRef({ lineas, sincronizar });
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    const { lineas, sincronizar } = initial.current;
    Promise.all(
      lineas.map(async (l) => {
        try {
          return (
            await graphql<{ producto: Producto }>(
              `query($id:Int!){producto(id:$id){${PRODUCTO}}}`,
              { id: l.producto.id },
            )
          ).producto;
        } catch (e) {
          if (e instanceof Error && e.message.includes("ya no está disponible"))
            return { ...l.producto, stock: 0 };
          throw e;
        }
      }),
    )
      .then((p) => {
        if (alive) sincronizar(p);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [revision]);
  if (!lineas.length)
    return (
      <Vacio
        titulo="Tu carrito está esperando"
        texto="Explora el catálogo y encuentra tu próximo upgrade."
        accion="Explorar catálogo"
        onClick={() => navegar({ tipo: "catalogo" })}
      />
    );
  const invalido = lineas.some((l) => l.cantidad > l.producto.stock);
  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">CASI ES TUYO</span>
          <h1>Tu carrito</h1>
          <p>{lineas.length} productos elegidos para tu setup.</p>
        </div>
        <button
          className="text-btn"
          onClick={() => navegar({ tipo: "catalogo" })}
        >
          <ArrowLeft size={16} /> Seguir comprando
        </button>
      </div>
      {error && (
        <ErrorCarga
          mensaje={error}
          reintentar={() => setRevision((n) => n + 1)}
        />
      )}
      <div className="compra-grid">
        <div className="carrito-lista panel">
          {lineas.map(({ producto: p, cantidad }) => (
            <article className="carrito-linea" key={p.id}>
              <button
                className="mini-imagen"
                onClick={() => navegar({ tipo: "producto", id: p.id })}
              >
                <Imagen producto={p} />
              </button>
              <div className="linea-info">
                <span className="eyebrow muted">{p.marca}</span>
                <button
                  className="producto-nombre"
                  onClick={() => navegar({ tipo: "producto", id: p.id })}
                >
                  {p.nombre}
                </button>
                <span className="muted">{dinero(p.precio)} por unidad</span>
                {cantidad > p.stock && (
                  <span className="danger">
                    {p.stock
                      ? `Solo quedan ${p.stock}. Ajusta la cantidad.`
                      : "Agotado. Retira este producto."}
                  </span>
                )}
              </div>
              <Cantidad
                valor={cantidad}
                max={p.stock}
                onChange={(n) => cambiar(p.id, n)}
              />
              <strong>{dinero(p.precio * cantidad)}</strong>
              <button
                className="icon-btn"
                aria-label={`Quitar ${p.nombre}`}
                onClick={() => quitar(p.id)}
              >
                <Trash2 size={18} />
              </button>
            </article>
          ))}
        </div>
        <Resumen>
          <button
            className="btn full"
            disabled={loading || !!error || invalido}
            onClick={() => navegar({ tipo: "checkout" })}
          >
            {loading ? "Actualizando precios…" : "Continuar al checkout"}
            <ArrowRight size={17} />
          </button>
          {invalido && (
            <p className="danger">
              Revisa la disponibilidad antes de continuar.
            </p>
          )}
        </Resumen>
      </div>
    </>
  );
}
