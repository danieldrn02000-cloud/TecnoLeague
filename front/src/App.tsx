import { useEffect, useRef, useState, useTransition } from "react";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Gamepad2,
  Grid2X2,
  Laptop,
  Menu,
  Package,
  Search,
  Settings2,
  ShoppingBag,
  SlidersHorizontal,
  Truck,
  X,
  Zap,
  Headphones,
  Cpu,
} from "lucide-react";
import { useQuery, dinero } from "./api";
import { useCarrito } from "./store";
import type { AuthUser, Categoria, Pantalla, Pedido, Producto } from "./types";
import { Catalogo } from "./screens/Catalogo";
import { Detalle } from "./screens/Detalle";
import { Carrito } from "./screens/Carrito";
import { Checkout } from "./screens/Checkout";
import { Pedidos } from "./screens/Pedidos";
import { Admin } from "./screens/Admin";
const iconos = [Laptop, Cpu, Headphones, Gamepad2];
export default function App({
  currentUser = null,
}: {
  currentUser?: AuthUser | null;
}) {
  const [pantalla, setPantalla] = useState<Pantalla>({ tipo: "inicio" });
  const [search, setSearch] = useState("");
  const [buscar, setBuscar] = useState("");
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState("");
  const [compra, setCompra] = useState<Pedido | null>(null);
  const [pending, startTransition] = useTransition();
  const { lineas, agregar: agregarCarrito, unidades, total } = useCarrito();
  const { data, error, retry } = useQuery<{ categorias: Categoria[] }>(
    "{categorias{id nombre}}",
  );
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    if (pantalla.tipo === "admin") return;
    const recargar = () => {
      if (!document.hidden) retry();
    };
    const intervalo = setInterval(recargar, 30000);
    window.addEventListener("focus", recargar);
    document.addEventListener("visibilitychange", recargar);
    return () => {
      clearInterval(intervalo);
      window.removeEventListener("focus", recargar);
      document.removeEventListener("visibilitychange", recargar);
    };
  }, [pantalla.tipo, retry]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  useEffect(() => {
  if (!currentUser) return;

  try {
    const pendiente = window.sessionStorage.getItem(
      "tl-pantalla-pendiente",
    );

    window.sessionStorage.removeItem("tl-pantalla-pendiente");

    if (pendiente === "checkout" || pendiente === "pedidos" || pendiente === "carrito") {
      setPantalla({ tipo: pendiente });
    }
  } catch {
    // Si no se puede recuperar, permanece en el inicio.
  }
}, [currentUser]);

useEffect(() => {
  const guardarPantalla = () => {
    try {
      if (pantalla.tipo === "checkout" || pantalla.tipo === "pedidos") {
        window.sessionStorage.setItem(
          "tl-pantalla-pendiente",
          pantalla.tipo,
        );
      }
    } catch {
      // No interrumpe la navegación.
    }
  };

  window.addEventListener("tl-sesion-invalida", guardarPantalla);

  return () => {
    window.removeEventListener("tl-sesion-invalida", guardarPantalla);
  };
}, [pantalla.tipo]);
  function avisar(s: string) {
    setToast(s);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(""), 4500);
  }
  const esAdmin = currentUser?.rol === "ADMIN";

  function navegar(p: Pantalla) {
    if (p.tipo === "admin" && !esAdmin) {
      avisar("Necesitas una cuenta administradora para acceder al panel.");
      setMenu(false);
      return;
    }
    if (!currentUser && (p.tipo === "checkout" || p.tipo === "pedidos")) {
      try {
        window.sessionStorage.setItem("tl-pantalla-pendiente", p.tipo);
      } catch {
        // El login sigue funcionando aunque el almacenamiento no esté disponible.
      }

      window.location.assign(
        `/iniciar-sesion?reason=${p.tipo}&next=${encodeURIComponent("/")}`,
      );
      return;
    }
    if (p.tipo === "catalogo" || p.tipo === "inicio") {
      setSearch("");
      setBuscar("");
    }
    startTransition(() => setPantalla(p));
    setMenu(false);
    window.scrollTo({ top: 0, behavior: "instant" });
    requestAnimationFrame(() => main.current?.focus({ preventScroll: true }));
  }
  function agregar(p: Producto) {
    const n = lineas.find((l) => l.producto.id === p.id)?.cantidad || 0;
    if (n >= Math.min(p.stock, 99)) {
      avisar("Ya agregaste la cantidad disponible de este producto.");
      return;
    }
    agregarCarrito(p);
    avisar(`${p.nombre} agregado al carrito`);
  }
  const catalogo = pantalla.tipo === "inicio" || pantalla.tipo === "catalogo";
  const categoriaId =
    pantalla.tipo === "catalogo" ? pantalla.categoriaId : undefined;
  return (
    <>
      <a className="skip-link" href="#contenido">
        Saltar al contenido
      </a>
      <div className="announcement">
        <span>HARDWARE PARA QUIENES COMPITEN POR MÁS</span>
        <span>TecnoLeague / Tienda de demostración</span>
      </div>
      <header className="topbar">
        <div className="topbar-inner">
          <button
            className="brand"
            onClick={() => navegar({ tipo: "inicio" })}
            aria-label="TecnoLeague, inicio"
          >
            <span className="logo">
              <img src="/images/logo.png" alt="TecnoLeague" />
            </span>
          </button>
          <nav aria-label="Navegación principal">
            <button
              className={pantalla.tipo === "inicio" ? "active" : ""}
              onClick={() => navegar({ tipo: "inicio" })}
            >
              Inicio
            </button>
            <button
              className={
                pantalla.tipo === "catalogo" || pantalla.tipo === "producto"
                  ? "active"
                  : ""
              }
              onClick={() => navegar({ tipo: "catalogo" })}
            >
              Catálogo
            </button>
            <button
              className={pantalla.tipo === "pedidos" ? "active" : ""}
              onClick={() => navegar({ tipo: "pedidos" })}
            >
              Pedidos
            </button>
          </nav>
          <form
            className="search"
            onSubmit={(e) => {
              e.preventDefault();
              setBuscar(search.trim());
              startTransition(() => setPantalla({ tipo: "catalogo" }));
              setMenu(false);
            }}
          >
            <Search size={18} />
            <input
              aria-label="Buscar productos"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar productos"
            />
            <button aria-label="Realizar búsqueda" type="submit">
              <ArrowRight size={16} />
            </button>
          </form>
          <div className="account-nav">
            {currentUser ? (
              <>
                <span title={currentUser.email}>
                  {currentUser.nombre.split(" ")[0]}
                </span>
                <form action="/api/auth/logout" method="post">
                  <button className="text-btn" type="submit">
                    Cerrar sesión
                  </button>
                </form>
              </>
            ) : (
              <a className="text-btn" href="/iniciar-sesion">
                Iniciar sesión
              </a>
            )}
          </div>
          {esAdmin && (
            <button
              className="icon-btn admin-nav"
              onClick={() => navegar({ tipo: "admin" })}
              aria-label="Administración"
            >
              <Settings2 size={21} />
            </button>
          )}
          <button
            className="cart-nav"
            onClick={() => navegar({ tipo: "carrito" })}
            aria-label={`Carrito: ${unidades} artículos`}
          >
            <ShoppingBag size={22} />
            <span>{unidades}</span>
          </button>
          {catalogo && (
            <button
              className="icon-btn mobile-menu"
              aria-label="Mostrar categorías"
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              {menu ? <X /> : <Menu />}
            </button>
          )}
        </div>
      </header>
      <div className={`shell ${catalogo ? "con-sidebar" : ""}`}>
        {catalogo && (
          <aside className={`sidebar ${menu ? "abierto" : ""}`}>
            <span className="sidebar-label">
              <SlidersHorizontal size={15} /> EXPLORAR
            </span>
            <h2>Encuentra tu equipo</h2>
            <button
              className={
                !categoriaId && pantalla.tipo === "catalogo"
                  ? "category active"
                  : "category"
              }
              onClick={() => navegar({ tipo: "catalogo" })}
            >
              <Grid2X2 size={19} /> Todo el catálogo <ChevronRight size={14} />
            </button>
            {data?.categorias.map((c, i) => {
              const Icon = iconos[i] || Package;
              return (
                <button
                  key={c.id}
                  className={`category ${categoriaId === c.id ? "active" : ""}`}
                  onClick={() =>
                    navegar({ tipo: "catalogo", categoriaId: c.id })
                  }
                >
                  <Icon size={19} />
                  {c.nombre}
                  <ChevronRight size={14} />
                </button>
              );
            })}
            {error && (
              <button className="text-btn" onClick={retry}>
                Reintentar categorías
              </button>
            )}
            <div className="sidebar-cart">
              <ShoppingBag size={23} />
              <strong>Tu siguiente upgrade</strong>
              <p>
                {unidades
                  ? `${unidades} artículos en tu carrito`
                  : "Tu setup empieza con una elección."}
              </p>
              {unidades > 0 && (
                <strong className="accent">{dinero(total)}</strong>
              )}
              <button
                className="text-btn"
                onClick={() => navegar({ tipo: "carrito" })}
              >
                Ver carrito <ArrowRight size={15} />
              </button>
            </div>
            <p className="sidebar-foot">
              DISEÑADO PARA
              <br />
              <strong>EL SIGUIENTE NIVEL.</strong>
            </p>
          </aside>
        )}
        <main
          id="contenido"
          tabIndex={-1}
          ref={main}
          className={pending ? "page pending" : "page"}
        >
          {compra && pantalla.tipo === "inicio" && (
            <section className="confirmacion" role="status">
              <div className="success-icon">
                <Check size={24} />
              </div>
              <div>
                <h2>¡Tu pedido está confirmado!</h2>
                <p>
                  {compra.folio} · {dinero(compra.total)} MXN.
                </p>
              </div>
              <button
                className="text-btn"
                onClick={() => {
                  setCompra(null);
                  navegar({ tipo: "pedidos" });
                }}
              >
                Ver pedido <ArrowRight size={17} />
              </button>
              <button
                className="icon-btn"
                onClick={() => setCompra(null)}
                aria-label="Cerrar confirmación"
              >
                <X size={18} />
              </button>
            </section>
          )}
          {catalogo && (
            <Catalogo
              key={`${pantalla.tipo}-${categoriaId || 0}-${buscar}`}
              inicio={pantalla.tipo === "inicio"}
              categoriaId={categoriaId}
              categoriaNombre={
                data?.categorias.find((c) => c.id === categoriaId)?.nombre
              }
              buscar={buscar}
              navegar={navegar}
              agregar={agregar}
            />
          )}
          {pantalla.tipo === "producto" && (
            <Detalle
              key={pantalla.id}
              id={pantalla.id}
              navegar={navegar}
              avisar={avisar}
            />
          )}
          {pantalla.tipo === "carrito" && <Carrito navegar={navegar} />}
          {pantalla.tipo === "checkout" && (
            <Checkout
              currentUser={currentUser!}
              navegar={navegar}
              completado={(p) => {
                setCompra(p);
                navegar({ tipo: "inicio" });
              }}
            />
          )}
          {pantalla.tipo === "pedidos" && <Pedidos navegar={navegar} />}
          {pantalla.tipo === "admin" && esAdmin && <Admin avisar={avisar} />}
        </main>
      </div>
      <footer className="footer">
        <div>
          <button className="brand" onClick={() => navegar({ tipo: "inicio" })}>
            <Zap className="accent" size={23} />
            <span>
              TECNO<span className="accent">LEAGUE</span>
            </span>
          </button>
          <p>Hardware para quienes compiten por más.</p>
        </div>
        <div>
          <h3>Explora</h3>
          <button onClick={() => navegar({ tipo: "catalogo" })}>
            Catálogo
          </button>
          <button onClick={() => navegar({ tipo: "pedidos" })}>
            Mis pedidos
          </button>
        </div>
        <div>
          <h3>Tu compra</h3>
          <span>
            <Truck size={15} /> Pago con Mercado Pago
          </span>
          <button onClick={() => navegar({ tipo: "carrito" })}>
            Mi carrito
          </button>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} TecnoLeague</span>
          <span>Proyecto académico · MXN</span>
        </div>
      </footer>
      {toast && (
        <div className="toast" role="status">
          <Check size={19} />
          <span>{toast}</span>
          <button
            className="icon-btn"
            onClick={() => setToast("")}
            aria-label="Cerrar aviso"
          >
            <X size={16} />
          </button>
        </div>
      )}
    </>
  );
}
