import { useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Check, Package, Truck } from "lucide-react";
import { graphql, PEDIDO } from "../api";
import { useCarrito } from "../store";
import type { AuthUser, Navegar, Pedido } from "../types";
import { Resumen } from "./Carrito";
import { Vacio } from "../components/ui";
export function Checkout({
  currentUser,
  navegar,
}: {
  currentUser: AuthUser;
  navegar: Navegar;
  completado: (p: Pedido) => void;
}) {
  const { lineas, vaciar } = useCarrito();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const bloqueado = useRef(false);
  const pedidoCreado = useRef<Pedido | null>(null);
  const solicitud = useRef({ contenido: "", clave: "" });
  if (!lineas.length)
    return (
      <Vacio
        titulo="No hay productos en el carrito"
        texto="Agrega un producto para continuar."
        accion="Ver catálogo"
        onClick={() => navegar({ tipo: "catalogo" })}
      />
    );
    
  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
      if (bloqueado.current) return;
      bloqueado.current = true;
    setBusy(true);
    setError("");

    const form = new FormData(e.currentTarget);
    const payload = {
      nombre: String(form.get("nombre")).trim(),
      email: String(form.get("email")).trim(),
      direccion: String(form.get("direccion")).trim(),
      renglones: lineas.map((l) => ({
        productoId: l.producto.id,
        cantidad: l.cantidad,
      })),
    };

    const contenido = JSON.stringify(payload);
      if (solicitud.current.contenido !== contenido)
        solicitud.current = { contenido, clave: crypto.randomUUID() };
      
    try {
      if (!pedidoCreado.current) {
      const { crearPedido } = await graphql<{ crearPedido: Pedido }>(
        `mutation Comprar($datos:PedidoInput!){crearPedido(datos:$datos){${PEDIDO}}}`,
        { datos: { ...payload, claveSolicitud: solicitud.current.clave } },
      );
      pedidoCreado.current = crearPedido;
      }
      const { iniciarPago } = await graphql<{ iniciarPago: { pagoId: number; checkoutUrl: string } }>(
        `mutation Pagar($pedidoId:Int!){iniciarPago(pedidoId:$pedidoId){pagoId checkoutUrl}}`,
        { pedidoId: pedidoCreado.current.id },
      );
      vaciar();
      window.location.assign(iniciarPago.checkoutUrl);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No se pudo registrar el pedido.",
      );
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
          <fieldset disabled={busy || !!pedidoCreado.current}>
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
              Dirección de entrega
              <textarea
                name="direccion"
                autoComplete="street-address"
                required
                minLength={10}
                maxLength={500}
                rows={3}
                placeholder="Calle, número, colonia, ciudad y código postal"
              />
            </label>
          </fieldset>
          <div className="pago">
            <Package size={23} />
            <div>
              <strong>Mercado Pago — pruebas</strong>
              <p>Se abrirá Mercado Pago. Usa el comprador y las tarjetas de prueba.</p>
            </div>
            <Check size={18} />
          </div>
          {error && (
            <div className="form-error" role="alert">
              {error}
              <button
                type="button"
                className="text-btn"
                onClick={() => navegar({ tipo: "carrito" })}
              >
                Revisar carrito
              </button>
            </div>
          )}
        </div>
        <Resumen>
          <button type="submit" className="btn full" disabled={busy}>
            {busy ? "Abriendo Mercado Pago…" : "Pagar con Mercado Pago"}
            <Check size={18} />
          </button>
          <p className="muted text-sm">
            El servidor valida existencias y calcula el total al confirmar.
          </p>
        </Resumen>
      </form>
    </>
  );
}
