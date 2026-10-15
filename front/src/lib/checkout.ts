import type { Linea } from "../types";
export type RenglonCompra = { productoId: number; cantidad: number };
export type EstadoCheckout = {
  intentoId: string;
  estado: "INICIADO" | "EN_PROCESO" | "CONFIRMADO" | "RECHAZADO" | "CANCELADO" | "EXPIRADO";
  pedidoId: number | null;
  aviso: string | null;
  checkoutUrl: string | null;
  expiraEn: string;
  renglones: RenglonCompra[];
};
export const CONSULTAR_INTENTO = `query($id:ID!){estadoIntento(intentoId:$id){intentoId estado pedidoId expiraEn aviso checkoutUrl renglones{productoId cantidad}}}`;
const clave = (usuarioId: number) => `tl-checkout-${usuarioId}`;

export function guardarIntento(usuarioId: number, intentoId: string) {
  // Si falla el almacenamiento, no iniciamos un checkout que no pueda recuperarse.
  localStorage.setItem(clave(usuarioId), intentoId);
}
export function leerIntento(usuarioId: number) {
  try { return localStorage.getItem(clave(usuarioId)); } catch { return null; }
}
export function olvidarIntento(usuarioId: number, intentoId: string) {
  if (leerIntento(usuarioId) === intentoId) localStorage.removeItem(clave(usuarioId));
}

export function descontarCompra(lineas: Linea[], compradas: RenglonCompra[]) {
  const cantidades = new Map(compradas.map(l => [l.productoId, l.cantidad]));
  return lineas.map(l => ({ ...l, cantidad: Math.max(0, l.cantidad - (cantidades.get(l.producto.id) ?? 0)) }))
    .filter(l => l.cantidad > 0);
}

export async function aplicarCompraConfirmada(usuarioId: number, compra: EstadoCheckout) {
  if (compra.estado !== "CONFIRMADO" || !compra.pedidoId) return;
  const aplicar = () => {
    const marca = `tl-compra-aplicada-${usuarioId}-${compra.intentoId}`;
    if (!localStorage.getItem(marca)) {
      const guardado = JSON.parse(localStorage.getItem("tl-carrito-v1") || "[]");
      if (!Array.isArray(guardado)) throw new Error("No se pudo leer el carrito guardado.");
      const nuevas = descontarCompra(guardado, compra.renglones);
      localStorage.setItem("tl-carrito-v1", JSON.stringify(nuevas));
      localStorage.setItem(marca, "1");
      window.dispatchEvent(new Event("tl-carrito-actualizado"));
    }
    olvidarIntento(usuarioId, compra.intentoId);
  };
  // Evita descontar dos veces si el retorno se abre simultáneamente en dos pestañas.
  if (navigator.locks) await navigator.locks.request("tl-carrito-confirmacion", aplicar);
  else aplicar();
}
