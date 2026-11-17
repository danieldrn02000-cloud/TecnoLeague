export function folioPedido(pedido: { id: number; fecha: Date }) {
  return `TL-${pedido.fecha.getFullYear()}-${String(pedido.id).padStart(4, "0")}`;
}
