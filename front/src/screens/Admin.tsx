import { useEffect, useState, type FormEvent } from "react";
import {
  Archive,
  Boxes,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Package,
  Pencil,
  Plus,
  Search,
  Tags,
  Trash2,
  Users,
} from "lucide-react";
import { dinero, graphql, PRODUCTO, useQuery } from "../api";
import { Cargando, ErrorCarga, Imagen, Modal } from "../components/ui";
import type { Categoria, PaginaProductos, Producto } from "../types";
const CONSULTA = `query Inventario{productos(limite:100){total items{${PRODUCTO}}} categorias{id nombre}}`;
type SeccionAdmin =
  | "dashboard"
  | "productos"
  | "pedidos"
  | "inventario"
  | "clientes"
  | "pagos"
  | "categorias";
const SECCIONES: {
  id: SeccionAdmin;
  nombre: string;
  Icono: typeof LayoutDashboard;
}[] = [
  { id: "dashboard", nombre: "Dashboard", Icono: LayoutDashboard },
  { id: "productos", nombre: "Productos", Icono: Package },
  { id: "pedidos", nombre: "Pedidos", Icono: Archive },
  { id: "inventario", nombre: "Inventario", Icono: Boxes },
  { id: "clientes", nombre: "Clientes", Icono: Users },
  { id: "pagos", nombre: "Pagos", Icono: CreditCard },
  { id: "categorias", nombre: "Categorías", Icono: Tags },
];
export function Admin({ avisar }: { avisar: (s: string) => void }) {
  const { data, loading, error, retry } = useQuery<{
    verificarAdmin: boolean;
  }>("query AccesoAdmin { verificarAdmin }");

  if (loading) return <Cargando />;

  if (error) {
    return (
      <div className="admin-login panel">
        <h1>Acceso a administración</h1>
        <ErrorCarga mensaje={error} reintentar={retry} />
        <p>Para administrar productos necesitas una cuenta con rol ADMIN.</p>
        <a className="btn btn-secondary" href="/iniciar-sesion">
          Iniciar sesión
        </a>
      </div>
    );
  }

  if (!data?.verificarAdmin) {
    return <p role="alert">No tienes permiso para acceder al inventario.</p>;
  }

  return <PanelAdmin avisar={avisar} />;
}

function PanelAdmin({ avisar }: { avisar: (s: string) => void }) {
  const [seccion, setSeccion] = useState<SeccionAdmin>("dashboard");
  const { data } = useQuery<{
    usuarioActual: { nombre: string; email: string };
  }>("query AdminIdentidad{usuarioActual{nombre email}}");
  const titulo = SECCIONES.find((item) => item.id === seccion)?.nombre;
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar" aria-label="Administración">
        <span className="eyebrow">GESTIÓN DE TIENDA</span>
        <nav>
          {SECCIONES.map(({ id, nombre, Icono }) => (
            <button
              key={id}
              className={seccion === id ? "admin-nav-active" : ""}
              aria-current={seccion === id ? "page" : undefined}
              onClick={() => setSeccion(id)}
            >
              <Icono size={17} />
              {nombre}
            </button>
          ))}
        </nav>
        <div className="admin-account">
          <strong>{data?.usuarioActual.nombre || "Administrador"}</strong>
          <span>{data?.usuarioActual.email || "Cuenta de administración"}</span>
          <form action="/api/auth/logout" method="post">
            <button className="btn btn-secondary" type="submit">
              <LogOut size={16} /> Cerrar sesión
            </button>
          </form>
        </div>
      </aside>
      <section className="admin-content">
        <header className="admin-topline">
          <div>
            <span className="eyebrow">PANEL DE CONTROL</span>
            <h1>{titulo}</h1>
          </div>
          <span className="admin-welcome">
            {data?.usuarioActual.nombre
              ? `Hola, ${data.usuarioActual.nombre}`
              : ""}
          </span>
        </header>
        {seccion === "dashboard" && (
          <DashboardAdmin cambiarSeccion={setSeccion} />
        )}
        {seccion === "productos" && <Inventario avisar={avisar} />}
        {seccion === "pedidos" && <PedidosAdmin avisar={avisar} />}
        {seccion === "inventario" && <ExistenciasAdmin avisar={avisar} />}
        {seccion === "clientes" && <ClientesAdmin />}
        {seccion === "pagos" && <PagosAdmin />}
        {seccion === "categorias" && <CategoriasAdmin avisar={avisar} />}
      </section>
    </div>
  );
}

function fechaLocal(fecha: Date) {
  const año = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, "0");
  const dia = String(fecha.getDate()).padStart(2, "0");
  return `${año}-${mes}-${dia}`;
}

const rangoInicial = () => {
  const fin = new Date();
  const inicio = new Date(fin);
  inicio.setDate(inicio.getDate() - 6);
  return { desde: fechaLocal(inicio), hasta: fechaLocal(fin) };
};

function DashboardAdmin({
  cambiarSeccion,
}: {
  cambiarSeccion: (seccion: SeccionAdmin) => void;
}) {
  const [rango, setRango] = useState(rangoInicial);
  const desde = `${rango.desde}T00:00:00.000Z`;
  const hasta = `${rango.hasta}T23:59:59.999Z`;
  const consulta = `query($desde:String!,$hasta:String!){adminDashboard(desde:$desde,hasta:$hasta){ventasTotales totalPedidos pedidosPendientes productosActivos stockBajo sinExistencias ventasPorDia{fecha total} pedidosRecientes{id folio fecha total status nombre email metodoPago} movimientosRecientes{id tipo cantidad motivo creadoEn producto{id nombre stock} usuario{id nombre}}}}`;
  const { data, loading, error, retry } = useQuery<{
    adminDashboard: {
      ventasTotales: number;
      totalPedidos: number;
      pedidosPendientes: number;
      productosActivos: number;
      stockBajo: number;
      sinExistencias: number;
      ventasPorDia: { fecha: string; total: number }[];
      pedidosRecientes: {
        id: number;
        folio: string;
        fecha: string;
        total: number;
        status: string;
        nombre: string;
        email: string;
      }[];
      movimientosRecientes: {
        id: number;
        tipo: string;
        cantidad: number;
        motivo: string;
        creadoEn: string;
        producto: { id: number; nombre: string; stock: number };
        usuario: { id: number; nombre: string } | null;
      }[];
    };
  }>(consulta, { desde, hasta });
  useEffect(() => {
    const actualizarSiVisible = () => {
      if (document.visibilityState === "visible") retry();
    };
    const intervalo = window.setInterval(actualizarSiVisible, 15_000);
    window.addEventListener("focus", actualizarSiVisible);
    return () => {
      window.clearInterval(intervalo);
      window.removeEventListener("focus", actualizarSiVisible);
    };
  }, [retry]);
  const dashboard = data?.adminDashboard;
  const maxVenta = Math.max(
    ...(dashboard?.ventasPorDia.map((dia) => dia.total) || [0]),
    1,
  );
  return (
    <>
      <div className="admin-section-tools">
        <div className="admin-date-filters">
          <span className="muted">
            {loading
              ? "Actualizando datos…"
              : "Actualización automática cada 15 segundos."}
          </span>
          <button
            className="btn btn-secondary"
            onClick={() => {
              const hoy = fechaLocal(new Date());
              setRango({ desde: hoy, hasta: hoy });
            }}
          >
            Hoy
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => setRango(rangoInicial())}
          >
            Últimos 7 días
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => {
              const fin = new Date();
              const inicio = new Date(fin);
              inicio.setDate(inicio.getDate() - 29);
              setRango({ desde: fechaLocal(inicio), hasta: fechaLocal(fin) });
            }}
          >
            Últimos 30 días
          </button>
          <label>
            Desde
            <input
              type="date"
              value={rango.desde}
              onChange={(e) =>
                setRango((v) => ({ ...v, desde: e.target.value }))
              }
            />
          </label>
          <label>
            Hasta
            <input
              type="date"
              value={rango.hasta}
              onChange={(e) =>
                setRango((v) => ({ ...v, hasta: e.target.value }))
              }
            />
          </label>
        </div>
      </div>
      {error ? (
        <ErrorCarga mensaje={error} reintentar={retry} />
      ) : loading && !dashboard ? (
        <Cargando />
      ) : dashboard ? (
        <>
          <div className="admin-kpis">
            <Kpi
              titulo="Ingresos confirmados"
              valor={dinero(dashboard.ventasTotales)}
            />
            <Kpi
              titulo="Pedidos del periodo"
              valor={String(dashboard.totalPedidos)}
            />
            <Kpi
              titulo="Pendientes de atención"
              valor={String(dashboard.pedidosPendientes)}
            />
            <Kpi
              titulo="Productos activos"
              valor={String(dashboard.productosActivos)}
            />
            <Kpi
              titulo="Stock bajo / agotado"
              valor={`${dashboard.stockBajo} / ${dashboard.sinExistencias}`}
            />
          </div>
          <div className="admin-dashboard-grid">
            <section className="panel admin-panel">
              <h2>Ventas confirmadas</h2>
              <p className="muted">
                Incluye pagos en línea aprobados y pedidos contra entrega
                completados. Los pedidos pendientes o cancelados no se cuentan
                como ingresos.
              </p>
              <div
                className="admin-bars"
                role="img"
                aria-label="Ventas confirmadas por día"
              >
                {dashboard.ventasPorDia.length ? (
                  dashboard.ventasPorDia.map((dia) => (
                    <div className="admin-bar-item" key={dia.fecha}>
                      <div className="admin-bar-track">
                        <span
                          style={{
                            height: `${Math.max(4, (dia.total / maxVenta) * 100)}%`,
                          }}
                          title={dinero(dia.total)}
                        />
                      </div>
                      <small>{dia.fecha.slice(5)}</small>
                      <small>{dinero(dia.total)}</small>
                    </div>
                  ))
                ) : (
                  <p className="admin-empty">
                    No hay ventas confirmadas en este periodo.
                  </p>
                )}
              </div>
            </section>
            <section className="panel admin-panel">
              <div className="admin-panel-heading">
                <h2>Pedidos recientes</h2>
                <button
                  className="text-btn"
                  onClick={() => cambiarSeccion("pedidos")}
                >
                  Ver todos
                </button>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Pedido</th>
                      <th>Cliente</th>
                      <th>Estado</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.pedidosRecientes.map((pedido) => (
                      <tr key={pedido.id}>
                        <td>
                          {pedido.folio}
                          <small>
                            {new Date(pedido.fecha).toLocaleDateString("es-MX")}
                          </small>
                        </td>
                        <td>
                          {pedido.nombre}
                          <small>{pedido.email}</small>
                        </td>
                        <td>
                          <Estado etiqueta={pedido.status} />
                        </td>
                        <td>{dinero(pedido.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!dashboard.pedidosRecientes.length && (
                  <p className="admin-empty">Todavía no hay pedidos.</p>
                )}
              </div>
            </section>
            <section className="panel admin-panel admin-activity">
              <h2>Actividad reciente de inventario</h2>
              {dashboard.movimientosRecientes.map((movimiento) => (
                <div className="admin-activity-row" key={movimiento.id}>
                  <span className="admin-activity-dot" />
                  <span>
                    <strong>{movimiento.producto.nombre}</strong>
                    <small>
                      {movimiento.motivo} ·{" "}
                      {movimiento.usuario?.nombre || "Sistema"}
                    </small>
                  </span>
                  <b className={movimiento.cantidad < 0 ? "danger" : "accent"}>
                    {movimiento.cantidad > 0 ? "+" : ""}
                    {movimiento.cantidad}
                  </b>
                </div>
              ))}
              {!dashboard.movimientosRecientes.length && (
                <p className="admin-empty">
                  No hay movimientos registrados todavía.
                </p>
              )}
            </section>
          </div>
        </>
      ) : null}
    </>
  );
}

function Kpi({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="panel admin-kpi">
      <span>{titulo}</span>
      <strong>{valor}</strong>
    </div>
  );
}

function Estado({ etiqueta }: { etiqueta: string }) {
  return (
    <span className={`admin-status status-${etiqueta.toLowerCase()}`}>
      {etiqueta}
    </span>
  );
}

function PedidosAdmin({ avisar }: { avisar: (s: string) => void }) {
  const [buscar, setBuscar] = useState("");
  const [estado, setEstado] = useState("");
  const [metodoPago, setMetodoPago] = useState("");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [desde, setDesde] = useState(0);
  const [detalle, setDetalle] = useState<number | null>(null);
  const [mutationError, setMutationError] = useState("");
  const consulta = `query($buscar:String!,$estado:EstadoPedido,$metodoPago:String!,$fechaDesde:String,$fechaHasta:String,$desde:Int!){adminPedidos(buscar:$buscar,estado:$estado,metodoPago:$metodoPago,fechaDesde:$fechaDesde,fechaHasta:$fechaHasta,desde:$desde,limite:20){total items{id folio fecha total status nombre email direccion metodoPago estadoPago}}}`;
  const { data, loading, error, retry } = useQuery<{
    adminPedidos: {
      total: number;
      items: {
        id: number;
        folio: string;
        fecha: string;
        total: number;
        status: string;
        estadoPago: string;
        nombre: string;
        email: string;
        direccion: string;
        metodoPago: string;
      }[];
    };
  }>(consulta, {
    buscar,
    estado: estado || null,
    metodoPago,
    fechaDesde: fechaDesde || null,
    fechaHasta: fechaHasta || null,
    desde,
  });
  async function actualizar(id: number, status: string) {
    if (
      status === "CANCELADO" &&
      !confirm("¿Cancelar este pedido y devolver sus unidades al inventario?")
    )
      return;
    setMutationError("");
    try {
      await graphql(
        "mutation($id:Int!,$estado:EstadoPedido!,$motivo:String){actualizarEstadoPedido(id:$id,estado:$estado,motivo:$motivo){id}}",
        {
          id,
          estado: status,
          motivo: status === "CANCELADO" ? "Cancelación administrativa" : null,
        },
      );
      avisar("Estado del pedido actualizado");
      retry();
    } catch (e) {
      setMutationError((e as Error).message);
    }
  }
  return (
    <>
      <div className="admin-tools">
        <label className="admin-search">
          <Search size={17} />
          <input
            placeholder="Buscar folio o cliente"
            value={buscar}
            onChange={(e) => {
              setBuscar(e.target.value);
              setDesde(0);
            }}
          />
        </label>
        <label className="admin-filter-label">
          Estado
          <select
            value={estado}
            onChange={(e) => {
              setEstado(e.target.value);
              setDesde(0);
            }}
          >
            <option value="">Todos</option>
            {["PENDIENTE", "PAGADO", "ENVIADO", "ENTREGADO", "CANCELADO"].map(
              (s) => (
                <option key={s}>{s}</option>
              ),
            )}
          </select>
        </label>
        <label className="admin-filter-label">
          Método de pago
          <select
            value={metodoPago}
            onChange={(e) => {
              setMetodoPago(e.target.value);
              setDesde(0);
            }}
          >
            <option value="">Todos</option>
            <option value="PAGO_AL_RECIBIR">Pago al recibir</option>
            <option value="MERCADO_PAGO">Mercado Pago</option>
          </select>
        </label>
        <label className="admin-date-input">
          Desde
          <input
            type="date"
            value={fechaDesde}
            onChange={(e) => {
              setFechaDesde(e.target.value);
              setDesde(0);
            }}
          />
        </label>
        <label className="admin-date-input">
          Hasta
          <input
            type="date"
            value={fechaHasta}
            onChange={(e) => {
              setFechaHasta(e.target.value);
              setDesde(0);
            }}
          />
        </label>
      </div>
      {mutationError && (
        <p className="form-error" role="alert">
          {mutationError}
        </p>
      )}
      {error ? (
        <ErrorCarga mensaje={error} reintentar={retry} />
      ) : loading ? (
        <Cargando />
      ) : (
        <>
          <div className="panel table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Cliente</th>
                  <th>Fecha</th>
                  <th>Pago</th>
                  <th>Total</th>
                  <th>Estado y acciones</th>
                </tr>
              </thead>
              <tbody>
                {data?.adminPedidos.items.map((pedido) => (
                  <tr key={pedido.id}>
                    <td>
                      <button
                        className="text-btn"
                        onClick={() => setDetalle(pedido.id)}
                      >
                        {pedido.folio}
                      </button>
                    </td>
                    <td>
                      {pedido.nombre}
                      <small>{pedido.email}</small>
                    </td>
                    <td>{new Date(pedido.fecha).toLocaleString("es-MX")}</td>
                    <td>
                      {pedido.metodoPago.replaceAll("_", " ")}
                      <small>
                        <Estado etiqueta={pedido.estadoPago} />
                      </small>
                    </td>
                    <td>{dinero(pedido.total)}</td>
                    <td>
                      <div className="admin-order-actions">
                        <Estado etiqueta={pedido.status} />
                        {pedido.status === "PENDIENTE" &&
                          pedido.metodoPago === "PAGO_AL_RECIBIR" && (
                            <>
                              <button
                                className="btn btn-secondary"
                                onClick={() =>
                                  void actualizar(pedido.id, "ENVIADO")
                                }
                              >
                                Enviar
                              </button>
                              <button
                                className="admin-link-danger"
                                onClick={() =>
                                  void actualizar(pedido.id, "CANCELADO")
                                }
                              >
                                Cancelar
                              </button>
                            </>
                          )}
                        {pedido.status === "PENDIENTE" &&
                          pedido.metodoPago !== "PAGO_AL_RECIBIR" && (
                            <small className="muted">
                              Esperando confirmación de pago; no se puede enviar
                              ni cancelar desde aquí.
                            </small>
                          )}
                        {pedido.status === "PAGADO" && (
                          <button
                            className="btn btn-secondary"
                            onClick={() =>
                              void actualizar(pedido.id, "ENVIADO")
                            }
                          >
                            Marcar enviado
                          </button>
                        )}
                        {pedido.status === "ENVIADO" && (
                          <button
                            className="btn btn-secondary"
                            onClick={() =>
                              void actualizar(pedido.id, "ENTREGADO")
                            }
                          >
                            Marcar entregado
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data?.adminPedidos.items.length && (
              <p className="admin-empty">
                No hay pedidos que coincidan con estos filtros.
              </p>
            )}
          </div>
          <Paginacion
            desde={desde}
            total={data?.adminPedidos.total || 0}
            cambiar={setDesde}
          />
        </>
      )}
      {detalle !== null && (
        <DetallePedidoAdmin id={detalle} cerrar={() => setDetalle(null)} />
      )}
    </>
  );
}

function Paginacion({
  desde,
  total,
  cambiar,
}: {
  desde: number;
  total: number;
  cambiar: (n: number) => void;
}) {
  const limite = 20;
  return total > limite ? (
    <div className="paginacion">
      <button
        className="btn btn-secondary"
        disabled={!desde}
        onClick={() => cambiar(Math.max(0, desde - limite))}
      >
        Anterior
      </button>
      <span>
        {Math.floor(desde / limite) + 1} / {Math.ceil(total / limite)}
      </span>
      <button
        className="btn btn-secondary"
        disabled={desde + limite >= total}
        onClick={() => cambiar(desde + limite)}
      >
        Siguiente
      </button>
    </div>
  ) : null;
}

function DetallePedidoAdmin({
  id,
  cerrar,
}: {
  id: number;
  cerrar: () => void;
}) {
  const consulta = `query($id:Int!){adminPedido(id:$id){folio fecha status nombre email direccion metodoPago total detalles{id cantidad nombreProducto precioUnitario subtotal}}}`;
  const { data, loading, error, retry } = useQuery<{
    adminPedido: {
      folio: string;
      fecha: string;
      status: string;
      nombre: string;
      email: string;
      direccion: string;
      metodoPago: string;
      total: number;
      detalles: {
        id: number;
        cantidad: number;
        nombreProducto: string;
        precioUnitario: number;
        subtotal: number;
      }[];
    };
  }>(consulta, { id });
  const historial = useQuery<{
    historialPedido: {
      id: number;
      desde: string | null;
      hacia: string;
      motivo: string | null;
      creadoEn: string;
      actor: { id: number; nombre: string };
    }[];
  }>(
    "query($id:Int!){historialPedido(id:$id){id desde hacia motivo creadoEn actor{id nombre}}}",
    { id },
  );
  const pedido = data?.adminPedido;
  return (
    <Modal
      titulo={pedido ? `Pedido ${pedido.folio}` : "Detalle del pedido"}
      onClose={cerrar}
    >
      {loading ? (
        <Cargando />
      ) : error ? (
        <ErrorCarga mensaje={error} reintentar={retry} />
      ) : pedido ? (
        <>
          <div className="admin-order-info">
            <span>
              <b>Cliente</b>
              {pedido.nombre}
              <small>{pedido.email}</small>
            </span>
            <span>
              <b>Dirección</b>
              {pedido.direccion}
            </span>
            <span>
              <b>Fecha</b>
              {new Date(pedido.fecha).toLocaleString("es-MX")}
            </span>
            <span>
              <b>Pago</b>
              {pedido.metodoPago.replaceAll("_", " ")} · {pedido.status}
            </span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Cantidad</th>
                  <th>Precio</th>
                  <th>Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {pedido.detalles.map((linea) => (
                  <tr key={linea.id}>
                    <td>{linea.nombreProducto}</td>
                    <td>{linea.cantidad}</td>
                    <td>{dinero(linea.precioUnitario)}</td>
                    <td>{dinero(linea.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="admin-order-total">
            Total <strong>{dinero(pedido.total)}</strong>
          </p>
          <h3 className="admin-history-title">Historial de estados</h3>
          {historial.error ? (
            <ErrorCarga
              mensaje={historial.error}
              reintentar={historial.retry}
            />
          ) : historial.loading ? (
            <Cargando />
          ) : (
            <div className="admin-history">
              {historial.data?.historialPedido.map((evento) => (
                <p key={evento.id}>
                  <Estado etiqueta={evento.hacia} />
                  <span>
                    {evento.desde ? `${evento.desde} → ` : ""}
                    {evento.hacia}
                    <small>
                      {new Date(evento.creadoEn).toLocaleString("es-MX")} ·{" "}
                      {evento.actor.nombre}
                      {evento.motivo ? ` · ${evento.motivo}` : ""}
                    </small>
                  </span>
                </p>
              ))}
            </div>
          )}
        </>
      ) : null}
    </Modal>
  );
}

function ExistenciasAdmin({ avisar }: { avisar: (s: string) => void }) {
  const [buscar, setBuscar] = useState("");
  const [productoId, setProductoId] = useState<number | null>(null);
  const consulta = `query{productos(limite:100){total items{id nombre marca stock stockMinimo categoria{id nombre}}} adminMovimientos(limite:20){total items{id tipo cantidad motivo creadoEn producto{id nombre stock} usuario{id nombre}}}}`;
  const { data, loading, error, retry } = useQuery<{
    productos: {
      total: number;
      items: {
        id: number;
        nombre: string;
        marca: string;
        stock: number;
        stockMinimo: number;
        categoria: Categoria;
      }[];
    };
    adminMovimientos: {
      items: {
        id: number;
        tipo: string;
        cantidad: number;
        motivo: string;
        creadoEn: string;
        producto: { id: number; nombre: string; stock: number };
        usuario: { id: number; nombre: string } | null;
      }[];
    };
  }>(consulta);
  const productos =
    data?.productos.items.filter(
      (p) =>
        p.nombre.toLowerCase().includes(buscar.toLowerCase()) ||
        p.marca.toLowerCase().includes(buscar.toLowerCase()),
    ) || [];
  return (
    <>
      <div className="admin-tools">
        <label className="admin-search">
          <Search size={17} />
          <input
            placeholder="Buscar producto"
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
          />
        </label>
        <span className="muted">
          Las compras reducen el stock al confirmar el pedido; cancelar un
          pedido elegible lo devuelve automáticamente.
        </span>
      </div>
      {error ? (
        <ErrorCarga mensaje={error} reintentar={retry} />
      ) : loading ? (
        <Cargando />
      ) : (
        <>
          <div className="panel table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Categoría</th>
                  <th>Existencias</th>
                  <th>Mínimo</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {productos.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.nombre}
                      <small>{p.marca}</small>
                    </td>
                    <td>{p.categoria.nombre}</td>
                    <td>{p.stock}</td>
                    <td>{p.stockMinimo}</td>
                    <td>
                      <Estado
                        etiqueta={
                          p.stock === 0
                            ? "AGOTADO"
                            : p.stock <= p.stockMinimo
                              ? "STOCK_BAJO"
                              : "DISPONIBLE"
                        }
                      />
                    </td>
                    <td>
                      <button
                        className="btn btn-secondary"
                        onClick={() => setProductoId(p.id)}
                      >
                        Registrar movimiento
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!productos.length && (
              <p className="admin-empty">
                No hay productos coincidentes en esta vista.
              </p>
            )}
          </div>
          <section className="panel admin-panel admin-movements">
            <h2>Historial reciente de movimientos</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Producto</th>
                    <th>Tipo</th>
                    <th>Cantidad</th>
                    <th>Responsable</th>
                    <th>Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.adminMovimientos.items.map((m) => (
                    <tr key={m.id}>
                      <td>{new Date(m.creadoEn).toLocaleString("es-MX")}</td>
                      <td>{m.producto.nombre}</td>
                      <td>{m.tipo}</td>
                      <td className={m.cantidad < 0 ? "danger" : "accent"}>
                        {m.cantidad > 0 ? "+" : ""}
                        {m.cantidad}
                      </td>
                      <td>{m.usuario?.nombre || "Sistema"}</td>
                      <td>{m.motivo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!data?.adminMovimientos.items.length && (
                <p className="admin-empty">No hay movimientos registrados.</p>
              )}
            </div>
          </section>
        </>
      )}
      {productoId !== null && (
        <AjusteInventario
          productoId={productoId}
          cerrar={() => setProductoId(null)}
          guardado={() => {
            setProductoId(null);
            retry();
            avisar("Existencias actualizadas y movimiento registrado");
          }}
        />
      )}
    </>
  );
}

function AjusteInventario({
  productoId,
  cerrar,
  guardado,
}: {
  productoId: number;
  cerrar: () => void;
  guardado: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function guardar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const datos = new FormData(e.currentTarget);
    try {
      await graphql(
        "mutation($productoId:Int!,$cantidad:Int!,$tipo:TipoMovimientoInventario!,$motivo:String!){ajustarInventario(productoId:$productoId,cantidad:$cantidad,tipo:$tipo,motivo:$motivo){id}}",
        {
          productoId,
          cantidad: Number(datos.get("cantidad")),
          tipo: String(datos.get("tipo")),
          motivo: String(datos.get("motivo")),
        },
      );
      guardado();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      titulo="Registrar movimiento de inventario"
      onClose={() => {
        if (!busy) cerrar();
      }}
    >
      <form onSubmit={guardar}>
        <fieldset disabled={busy}>
          <label>
            Tipo de movimiento
            <select name="tipo">
              <option value="ENTRADA">Entrada de mercancía</option>
              <option value="SALIDA">Salida</option>
              <option value="AJUSTE">Establecer existencia exacta</option>
            </select>
          </label>
          <label>
            Cantidad
            <input
              name="cantidad"
              type="number"
              min="0"
              max="100000"
              step="1"
              required
            />
            <small>
              En ajuste, indica el stock final (incluido cero); en entradas y
              salidas, unidades a mover.
            </small>
          </label>
          <label>
            Motivo
            <textarea
              name="motivo"
              minLength={3}
              maxLength={300}
              required
              rows={3}
            />
          </label>
        </fieldset>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={cerrar}
          >
            Cancelar
          </button>
          <button className="btn" disabled={busy}>
            {busy ? "Guardando…" : "Guardar movimiento"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ClientesAdmin() {
  const [buscar, setBuscar] = useState("");
  const [desde, setDesde] = useState(0);
  const [clienteId, setClienteId] = useState<number | null>(null);
  const { data, loading, error, retry } = useQuery<{
    adminClientes: {
      total: number;
      items: {
        id: number;
        nombre: string;
        email: string;
        totalPedidos: number;
        gastoConfirmado: number;
        ultimaCompra: string | null;
      }[];
    };
  }>(
    "query($buscar:String!,$desde:Int!){adminClientes(buscar:$buscar,desde:$desde,limite:20){total items{id nombre email totalPedidos gastoConfirmado ultimaCompra}}}",
    { buscar, desde },
  );
  return (
    <>
      <div className="admin-tools">
        <label className="admin-search">
          <Search size={17} />
          <input
            placeholder="Buscar nombre, correo o ID"
            value={buscar}
            onChange={(e) => {
              setBuscar(e.target.value);
              setDesde(0);
            }}
          />
        </label>
      </div>
      {error ? (
        <ErrorCarga mensaje={error} reintentar={retry} />
      ) : loading ? (
        <Cargando />
      ) : (
        <>
          <div className="panel table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Pedidos</th>
                  <th>Compras confirmadas</th>
                  <th>Último pedido</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data?.adminClientes.items.map((c) => (
                  <tr key={c.id}>
                    <td>
                      {c.nombre}
                      <small>
                        {c.email} · ID {c.id}
                      </small>
                    </td>
                    <td>{c.totalPedidos}</td>
                    <td>{dinero(c.gastoConfirmado)}</td>
                    <td>
                      {c.ultimaCompra
                        ? new Date(c.ultimaCompra).toLocaleDateString("es-MX")
                        : "—"}
                    </td>
                    <td>
                      <button
                        className="btn btn-secondary"
                        onClick={() => setClienteId(c.id)}
                      >
                        Ver historial
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data?.adminClientes.items.length && (
              <p className="admin-empty">No hay clientes coincidentes.</p>
            )}
          </div>
          <Paginacion
            desde={desde}
            total={data?.adminClientes.total || 0}
            cambiar={setDesde}
          />
        </>
      )}
      {clienteId !== null && (
        <DetalleCliente id={clienteId} cerrar={() => setClienteId(null)} />
      )}
    </>
  );
}

function DetalleCliente({ id, cerrar }: { id: number; cerrar: () => void }) {
  const { data, loading, error, retry } = useQuery<{
    adminCliente: {
      nombre: string;
      email: string;
      pedidos: {
        id: number;
        folio: string;
        fecha: string;
        total: number;
        status: string;
        direccion: string;
        metodoPago: string;
      }[];
    };
  }>(
    "query($id:Int!){adminCliente(id:$id){nombre email pedidos{id folio fecha total status direccion metodoPago}}}",
    { id },
  );
  return (
    <Modal
      titulo={data?.adminCliente.nombre || "Historial de cliente"}
      onClose={cerrar}
    >
      {loading ? (
        <Cargando />
      ) : error ? (
        <ErrorCarga mensaje={error} reintentar={retry} />
      ) : data ? (
        <>
          <p>{data.adminCliente.email}</p>
          <div className="admin-customer-orders">
            {data.adminCliente.pedidos.map((pedido) => (
              <article key={pedido.id}>
                <div>
                  <b>{pedido.folio}</b>
                  <Estado etiqueta={pedido.status} />
                </div>
                <p>
                  {new Date(pedido.fecha).toLocaleString("es-MX")} ·{" "}
                  {pedido.metodoPago.replaceAll("_", " ")}
                </p>
                <p>{pedido.direccion}</p>
                <strong>{dinero(pedido.total)}</strong>
              </article>
            ))}
          </div>
          {!data.adminCliente.pedidos.length && (
            <p className="admin-empty">
              Este cliente todavía no tiene pedidos.
            </p>
          )}
        </>
      ) : null}
    </Modal>
  );
}

function PagosAdmin() {
  const [buscar, setBuscar] = useState("");
  const [estado, setEstado] = useState("");
  const [desde, setDesde] = useState(0);
  const { data, loading, error, retry } = useQuery<{
    adminPagos: {
      total: number;
      items: {
        id: number;
        proveedor: string;
        estado: string;
        monto: number;
        moneda: string;
        idOrdenExterna: string | null;
        idPagoExterno: string | null;
        estadoProveedor: string | null;
        intentoId: string | null;
        estadoIntento: string | null;
        ultimoError: string | null;
        creadoEn: string;
        aprobadoEn: string | null;
        pedido: {
          id: number;
          fecha: string;
          nombre: string;
          email: string;
          status: string;
        } | null;
      }[];
    };
  }>(
    "query($buscar:String!,$estado:EstadoPago,$desde:Int!){adminPagos(buscar:$buscar,estado:$estado,desde:$desde,limite:20){total items{id proveedor estado monto moneda idOrdenExterna idPagoExterno estadoProveedor intentoId estadoIntento ultimoError creadoEn aprobadoEn pedido{id fecha nombre email status}}}}",
    { buscar, estado: estado || null, desde },
  );
  return (
    <>
      <div className="admin-tools">
        <label className="admin-search">
          <Search size={17} />
          <input
            placeholder="Buscar transacción, pedido o cliente"
            value={buscar}
            onChange={(e) => {
              setBuscar(e.target.value);
              setDesde(0);
            }}
          />
        </label>
        <label className="admin-filter-label">
          Estado
          <select
            value={estado}
            onChange={(e) => {
              setEstado(e.target.value);
              setDesde(0);
            }}
          >
            <option value="">Todos</option>
            {[
              "PENDIENTE",
              "APROBADO",
              "RECHAZADO",
              "CANCELADO",
              "REEMBOLSADO",
            ].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>
      {error ? (
        <ErrorCarga mensaje={error} reintentar={retry} />
      ) : loading ? (
        <Cargando />
      ) : (
        <>
          <div className="panel table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Transacción</th>
                  <th>Pedido y cliente</th>
                  <th>Importe</th>
                  <th>Método</th>
                  <th>Fecha</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {data?.adminPagos.items.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.idPagoExterno || p.idOrdenExterna || `Pago #${p.id}`}
                      <small>{p.pedido ? `Pedido #${p.pedido.id}` : "Intento sin pedido confirmado"}</small>
                    </td>
                    <td>
                      {p.pedido?.nombre ?? "Checkout en proceso"}
                      <small>{p.pedido?.email ?? ""}</small>
                    </td>
                    <td>{dinero(p.monto)}</td>
                    <td>{p.proveedor.replaceAll("_", " ")}</td>
                    <td>{new Date(p.creadoEn).toLocaleString("es-MX")}</td>
                    <td>
                      <Estado etiqueta={p.estado} />
                      {p.estadoProveedor && <small>{p.estadoProveedor}</small>}
                      {p.intentoId && <small>Intento {p.intentoId}: {p.estadoIntento}</small>}
                      {p.ultimoError && <small role="alert">{p.ultimoError}</small>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data?.adminPagos.items.length && (
              <p className="admin-empty">
                No hay pagos para mostrar. Los estados son de solo lectura y se
                confirman por el proveedor.
              </p>
            )}
          </div>
          <Paginacion
            desde={desde}
            total={data?.adminPagos.total || 0}
            cambiar={setDesde}
          />
        </>
      )}
    </>
  );
}

function CategoriasAdmin({ avisar }: { avisar: (s: string) => void }) {
  const [nombre, setNombre] = useState("");
  const [errorMutacion, setErrorMutacion] = useState("");
  const [busy, setBusy] = useState(false);
  const { data, loading, error, retry } = useQuery<{
    adminCategorias: { id: number; nombre: string; productosCount: number }[];
  }>("query{adminCategorias{id nombre productosCount}}");
  async function crear(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErrorMutacion("");
    try {
      await graphql(
        "mutation($nombre:String!){crearCategoria(nombre:$nombre){id}}",
        { nombre },
      );
      setNombre("");
      avisar("Categoría creada");
      retry();
    } catch (e) {
      setErrorMutacion((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function eliminar(id: number, etiqueta: string) {
    if (
      !confirm(
        `¿Eliminar la categoría “${etiqueta}”? Esta acción no afecta pedidos.`,
      )
    )
      return;
    setErrorMutacion("");
    try {
      await graphql("mutation($id:Int!){eliminarCategoria(id:$id)}", { id });
      avisar("Categoría eliminada");
      retry();
    } catch (e) {
      setErrorMutacion((e as Error).message);
    }
  }
  async function editar(id: number, actual: string) {
    const nuevo = prompt("Nombre de la categoría", actual);
    if (nuevo === null || nuevo.trim() === actual) return;
    setErrorMutacion("");
    try {
      await graphql(
        "mutation($id:Int!,$nombre:String!){actualizarCategoria(id:$id,nombre:$nombre){id}}",
        { id, nombre: nuevo },
      );
      avisar("Categoría actualizada");
      retry();
    } catch (e) {
      setErrorMutacion((e as Error).message);
    }
  }
  return (
    <>
      <form className="panel admin-category-form" onSubmit={crear}>
        <label>
          Nueva categoría
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            required
            minLength={2}
            maxLength={80}
          />
        </label>
        <button className="btn" disabled={busy}>
          <Plus size={16} />
          {busy ? "Guardando…" : "Agregar categoría"}
        </button>
      </form>
      {errorMutacion && (
        <p role="alert" className="form-error">
          {errorMutacion}
        </p>
      )}
      {error ? (
        <ErrorCarga mensaje={error} reintentar={retry} />
      ) : loading ? (
        <Cargando />
      ) : (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Productos relacionados</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {data?.adminCategorias.map((c) => (
                <tr key={c.id}>
                  <td>{c.nombre}</td>
                  <td>{c.productosCount}</td>
                  <td>
                    <div className="flex gap-2">
                      <button
                        className="icon-btn"
                        aria-label={`Editar ${c.nombre}`}
                        onClick={() => void editar(c.id, c.nombre)}
                      >
                        <Pencil size={17} />
                      </button>
                      <button
                        className="icon-btn danger"
                        disabled={c.productosCount > 0}
                        title={
                          c.productosCount
                            ? "Reasigna o elimina sus productos antes"
                            : "Eliminar categoría"
                        }
                        aria-label={`Eliminar ${c.nombre}`}
                        onClick={() => void eliminar(c.id, c.nombre)}
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Inventario({ avisar }: { avisar: (s: string) => void }) {
  const { data, loading, error, retry } = useQuery<{
    productos: PaginaProductos;
    categorias: Categoria[];
  }>(CONSULTA);
  const [editor, setEditor] = useState<Producto | "nuevo" | null>(null);
  const [mutationError, setMutationError] = useState("");
  const [borrando, setBorrando] = useState<number | null>(null);
  const [pagina, setPagina] = useState(0);
  const [filtrar, setFiltrar] = useState("");
  async function eliminar(p: Producto) {
    if (
      !confirm(
        `¿Dar de baja ${p.nombre}? Se conservará en los pedidos anteriores.`,
      )
    )
      return;
    setBorrando(p.id);
    setMutationError("");
    try {
      await graphql("mutation($id:Int!){eliminarProducto(id:$id)}", {
        id: p.id,
      });
      avisar("Producto dado de baja");
      retry();
    } catch (e) {
      setMutationError((e as Error).message);
    } finally {
      setBorrando(null);
    }
  }
  const productos = (data?.productos.items || []).filter((p) =>
    p.nombre.toLowerCase().includes(filtrar.toLowerCase()),
  );
  useEffect(() => {
    if (pagina > 0 && pagina * 8 >= productos.length) setPagina(0);
  }, [productos.length, pagina]);
  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">PANEL DE CONTROL</span>
          <p>Administra los productos que aparecen en el catálogo.</p>
        </div>
        <div className="flex gap-3">
          <button className="btn" onClick={() => setEditor("nuevo")}>
            <Plus size={18} /> Nuevo producto
          </button>
        </div>
      </div>
      {mutationError && (
        <p role="alert" className="form-error">
          {mutationError}
        </p>
      )}
      {error ? (
        <ErrorCarga mensaje={error} reintentar={retry} />
      ) : loading ? (
        <Cargando />
      ) : (
        <>
          <div className="admin-stats">
            <div className="panel">
              <span>Productos activos</span>
              <strong>{data?.productos.total}</strong>
            </div>
            <div className="panel">
              <span>Unidades en inventario</span>
              <strong>
                {data?.productos.items.reduce((s, p) => s + p.stock, 0)}
              </strong>
            </div>
            <div className="panel">
              <span>Sin existencias</span>
              <strong>
                {data?.productos.items.filter((p) => p.stock === 0).length}
              </strong>
            </div>
          </div>
          <div className="admin-tools">
            <label>
              <span className="sr-only">Buscar en inventario</span>
              <input
                placeholder="Buscar producto…"
                value={filtrar}
                onChange={(e) => {
                  setFiltrar(e.target.value);
                  setPagina(0);
                }}
              />
            </label>
            <span className="muted">
              {productos.length} productos en esta vista
            </span>
          </div>
          {(data?.productos.total || 0) > 100 && (
            <p className="muted">
              Esta vista muestra los primeros 100 productos activos.
            </p>
          )}
          <div className="table-wrap panel">
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Categoría</th>
                  <th>Precio</th>
                  <th>Stock</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {productos.slice(pagina * 8, pagina * 8 + 8).map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div className="tabla-producto">
                        <Imagen producto={p} />
                        <span>
                          {p.nombre}
                          <small>{p.marca}</small>
                        </span>
                      </div>
                    </td>
                    <td>{p.categoria.nombre}</td>
                    <td>{dinero(p.precio)}</td>
                    <td>
                      <span className={p.stock ? "" : "danger"}>
                        {p.stock} unidades
                      </span>
                    </td>
                    <td>
                      <div className="flex gap-2">
                        <button
                          className="icon-btn"
                          onClick={() => setEditor(p)}
                          aria-label={`Editar ${p.nombre}`}
                        >
                          <Pencil size={17} />
                        </button>
                        <button
                          className="icon-btn danger"
                          disabled={borrando !== null}
                          onClick={() => eliminar(p)}
                          aria-label={`Eliminar ${p.nombre}`}
                        >
                          <Trash2 size={17} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!productos.length && (
              <p className="p-8 muted">No hay productos con ese nombre.</p>
            )}
          </div>
          {productos.length > 8 && (
            <div className="paginacion">
              <button
                className="btn btn-secondary"
                disabled={!pagina}
                onClick={() => setPagina((p) => p - 1)}
              >
                Anterior
              </button>
              <span>
                {pagina + 1} / {Math.ceil(productos.length / 8)}
              </span>
              <button
                className="btn btn-secondary"
                disabled={(pagina + 1) * 8 >= productos.length}
                onClick={() => setPagina((p) => p + 1)}
              >
                Siguiente
              </button>
            </div>
          )}
        </>
      )}
      {editor && data && (
        <Editor
          key={typeof editor === "string" ? editor : editor.id}
          producto={editor === "nuevo" ? undefined : editor}
          categorias={data.categorias}
          cerrar={() => setEditor(null)}
          guardado={() => {
            setEditor(null);
            retry();
            avisar("Producto guardado correctamente");
          }}
        />
      )}
    </>
  );
}
function Editor({
  producto: p,
  categorias,
  cerrar,
  guardado,
}: {
  producto?: Producto;
  categorias: Categoria[];
  cerrar: () => void;
  guardado: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function guardar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    const datos = {
      nombre: String(f.get("nombre")),
      marca: String(f.get("marca")),
      descripcion: String(f.get("descripcion")),
      precio: Number(f.get("precio")),
      stock: Number(f.get("stock")),
      stockMinimo: Number(f.get("stockMinimo")),
      categoriaId: Number(f.get("categoriaId")),
      imagen: String(f.get("imagen")),
      especificaciones: String(f.get("especificaciones")),
    };
    try {
      await graphql(
        p
          ? "mutation($id:Int!,$datos:ProductoInput!){actualizarProducto(id:$id,datos:$datos){id}}"
          : "mutation($datos:ProductoInput!){crearProducto(datos:$datos){id}}",
        { datos, ...(p ? { id: p.id } : {}) },
      );
      guardado();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      titulo={p ? "Editar producto" : "Nuevo producto"}
      onClose={() => {
        if (!busy) cerrar();
      }}
    >
      <form onSubmit={guardar}>
        <fieldset disabled={busy}>
          <div className="form-grid">
            <label>
              Nombre
              <input
                name="nombre"
                required
                maxLength={120}
                defaultValue={p?.nombre}
              />
            </label>
            <label>
              Marca
              <input
                name="marca"
                required
                maxLength={80}
                defaultValue={p?.marca}
              />
            </label>
            <label>
              Precio (MXN)
              <input
                name="precio"
                type="number"
                min="0.01"
                max="999999.99"
                step="0.01"
                required
                defaultValue={p?.precio}
              />
            </label>
            <label>
              Stock
              <input
                name="stock"
                type="number"
                min="0"
                max="100000"
                step="1"
                required
                readOnly={Boolean(p)}
                defaultValue={p?.stock ?? 1}
              />
              {p && (
                <small>
                  Para modificar existencias, registra un movimiento en
                  Inventario.
                </small>
              )}
            </label>
            <label>
              Nivel mínimo de existencias
              <input
                name="stockMinimo"
                type="number"
                min="0"
                max="100000"
                step="1"
                required
                defaultValue={p?.stockMinimo ?? 5}
              />
            </label>
            <label>
              Categoría
              <select
                name="categoriaId"
                defaultValue={p?.categoria.id || categorias[0]?.id}
              >
                {categorias.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Imagen
              <input
                name="imagen"
                required
                list="imagenes"
                defaultValue={p?.imagen || "/images/keyboard.jpg"}
              />
              <datalist id="imagenes">
                {[
                  "laptop.jpg",
                  "gpu.png",
                  "ram.jpg",
                  "keyboard.jpg",
                  "headphones.jpg",
                  "controller.jpg",
                  "controller-white.jpg",
                ].map((s) => (
                  <option key={s} value={`/images/${s}`} />
                ))}
              </datalist>
            </label>
          </div>
          <label>
            Descripción
            <textarea
              name="descripcion"
              rows={3}
              required
              maxLength={2000}
              defaultValue={p?.descripcion}
            />
          </label>
          <label>
            Especificaciones (separadas por ;)
            <textarea
              name="especificaciones"
              rows={2}
              maxLength={2000}
              defaultValue={p?.especificaciones}
            />
          </label>
        </fieldset>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={cerrar}
          >
            Cancelar
          </button>
          <button className="btn" disabled={busy}>
            {busy ? "Guardando…" : "Guardar producto"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
