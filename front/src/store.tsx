import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Linea, Producto } from "./types";
type CarritoContexto = {
  lineas: Linea[];
  agregar: (p: Producto, n?: number) => void;
  cambiar: (id: number, n: number) => void;
  quitar: (id: number) => void;
  vaciar: () => void;
  sincronizar: (productos: Producto[]) => void;
  total: number;
  unidades: number;
};

const Contexto = createContext<CarritoContexto | null>(null);
function recuperar(): Linea[] {
  try {
    const valor = JSON.parse(window.localStorage.getItem("tl-carrito-v1") || "[]");
    return Array.isArray(valor)
      ? valor.filter(
          (l: Linea) =>
            Number.isInteger(l?.producto?.id) &&
            typeof l.producto.nombre === "string" &&
            Number.isFinite(l.producto.precio) &&
            l.producto.categoria &&
            Number.isInteger(l.cantidad) &&
            l.cantidad > 0 &&
            l.cantidad <= 99,
        )
      : [];
  } catch {
    return [];
  }
}

export function CarritoProvider({ children }: { children: ReactNode }) {
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [listo, setListo] = useState(false);
  useEffect(() => {
    setLineas(recuperar());
    setListo(true);
  }, []);
  useEffect(() => {
    if (!listo) return;
    try {
      window.localStorage.setItem("tl-carrito-v1", JSON.stringify(lineas));
    } catch {
      /* Si no hay almacenamiento, el carrito sigue funcionando en memoria. */
    }
  }, [lineas, listo]);

  useEffect(() => {
    const actualizar = () => setLineas(recuperar());
    window.addEventListener("storage", actualizar);
    window.addEventListener("tl-carrito-actualizado", actualizar);
    return () => {
      window.removeEventListener("storage", actualizar);
      window.removeEventListener("tl-carrito-actualizado", actualizar);
    };
  }, []);

  function agregar(producto: Producto, cantidad = 1) {
    if (producto.stock < 1) return;
    setLineas((prev) => {
      const existe = prev.find((l) => l.producto.id === producto.id);
      const n = Math.min(
        99,
        producto.stock,
        (existe?.cantidad || 0) + cantidad,
      );
      return existe
        ? prev.map((l) =>
            l.producto.id === producto.id ? { producto, cantidad: n } : l,
          )
        : [...prev, { producto, cantidad: n }];
    });
  }

  function cambiar(id: number, n: number) {
    setLineas((prev) =>
      prev.map((l) =>
        l.producto.id === id
          ? {
              ...l,
              cantidad: Math.max(1, Math.min(99, l.producto.stock || 1, n)),
            }
          : l,
      ),
    );
  }

  function sincronizar(productos: Producto[]) {
    setLineas((prev) =>
      prev.map((l) => ({
        ...l,
        producto: productos.find((p) => p.id === l.producto.id) ?? {
          ...l.producto,
          stock: 0,
        },
      })),
    );
  }

  return (
    <Contexto.Provider
      value={{
        lineas,
        agregar,
        cambiar,
        quitar: (id) => setLineas((p) => p.filter((l) => l.producto.id !== id)),
        vaciar: () => setLineas([]),
        sincronizar,
        total:
          lineas.reduce(
            (s, l) => s + Math.round(l.producto.precio * 100) * l.cantidad,
            0,
          ) / 100,
        unidades: lineas.reduce((s, l) => s + l.cantidad, 0),
      }}
    >
      {children}
    </Contexto.Provider>
  );
}

export function useCarrito() {
  const c = useContext(Contexto);
  if (!c) throw new Error("Falta CarritoProvider");
  return c;
}
