import type { Rol } from "@prisma/client";

export interface ProductoInput {
  nombre: string;
  descripcion: string;
  precio: number;
  imagen: string;
  stock: number;
  stockMinimo: number;
  marca: string;
  especificaciones: string;
  categoriaId: number;
}
export interface PedidoInput {
  nombre: string;
  email: string;
  direccion: string;
  claveSolicitud: string;
  renglones: { productoId: number; cantidad: number }[];
}
export interface RegistroInput {
  nombre: string;
  email: string;
  password: string;
}
export interface CredencialesInput {
  email: string;
  password: string;
}

export interface DatosPagoInput {
  claveOperacion: string;
  token: string;
  metodoPagoId: string;
  tipoMetodoPago: "credit_card" | "debit_card";
  cuotas: number;
  email: string;
  identificacion?: { tipo: string; numero: string } | null;
}
export interface UsuarioAutenticado {
  id: number;
  nombre: string;
  email: string;
  rol: Rol;
}

export interface RequestContext {
  usuario?: UsuarioAutenticado;
  subscriptionTicket?: unknown; 
  req: { headers: Record<string, string | string[] | undefined> };
}
