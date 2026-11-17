export interface Categoria {
  id: number;
  nombre: string;
}
export interface AuthUser {
  id: number;
  nombre: string;
  email: string;
  rol: "ADMIN" | "CLIENTE";
}
export interface Producto {
  id: number;
  nombre: string;
  descripcion: string;
  precio: number;
  imagen: string;
  stock: number;
  marca: string;
  especificaciones: string;
  categoria: Categoria;
}
export interface PaginaProductos {
  items: Producto[];
  total: number;
}
export interface Linea {
  producto: Producto;
  cantidad: number;
}
export interface Pedido {
  id: number;
  folio: string;
  fecha: string;
  total: number;
  status: string;
  nombre: string;
  email: string;
  direccion: string;
  metodoPago: string;
  trackingNumber: string | null;
  trackingCarrierName: string | null;
  trackingStatus: string | null;
  trackingDescription: string | null;
  trackingUpdatedAt: string | null;
  detalles: {
    id: number;
    cantidad: number;
    nombreProducto: string;
    precioUnitario: number;
    subtotal: number;
    producto: Producto;
  }[];
}
export type Pantalla =
  | { tipo: "inicio" }
  | { tipo: "catalogo"; categoriaId?: number }
  | { tipo: "producto"; id: number }
  | { tipo: "carrito" }
  | { tipo: "checkout" }
  | { tipo: "pedidos" }
  | { tipo: "admin" };
export type Navegar = (pantalla: Pantalla) => void;
