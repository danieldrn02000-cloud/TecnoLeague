import { useEffect } from "react";
import { useEstadoPago } from "../lib/use-estado-pago";
import { ResultadoPago } from "./ResultadoPago";

export function RetornoPago({
  intentoId,
  usuarioId,
}: {
  intentoId: string;
  usuarioId: number;
}) {
  const [estado, setEstado] = useState<EstadoCheckout | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [noExiste, setNoExiste] = useState(false);
  const [revision, setRevision] = useState(0);
  const finalizado = useRef(false);

  useEffect(() => {
    let activo = true;
    let timer: ReturnType<typeof setTimeout>;
    let consultas = 0;
    async function consultar() {
      if (!activo || finalizado.current) return;
      setBusy(true);
      try {
        const { estadoIntento } = await graphql<{
          estadoIntento: EstadoCheckout;
        }>(CONSULTAR_INTENTO, { id: intentoId });
        if (!activo) return;
        setEstado(estadoIntento);
        setError(estadoIntento.aviso ?? "");
        if (estadoIntento.estado === "CONFIRMADO") {
          await aplicarCompraConfirmada(usuarioId, estadoIntento);
          finalizado.current = true;
        } else if (
          ["RECHAZADO", "CANCELADO", "EXPIRADO"].includes(estadoIntento.estado)
        ) {
          olvidarIntento(usuarioId, intentoId);
          finalizado.current = true;
        } else if (++consultas < 12) {
          timer = setTimeout(() => void consultar(), 5000);
        }
      } catch (e) {
        if (!activo) return;
        setError(
          e instanceof Error ? e.message : "No se pudo consultar el pago.",
        );
        if (e instanceof GraphQLError && e.code === "NOT_FOUND")
          setNoExiste(true);
      } finally {
        if (activo) setBusy(false);
      }
    }
    void consultar();
    return () => {
      activo = false;
      clearTimeout(timer);
    };
  }, [intentoId, usuarioId, revision]);

  async function cancelar() {
    setBusy(true);
    setError("");
    try {
      await graphql(
        "mutation($id:ID!){cancelarIntento(intentoId:$id){intentoId}}",
        { id: intentoId },
      );
      setRevision((n) => n + 1);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "No se pudo cancelar. Consulta otra vez antes de reintentar el pago.",
      );
    } finally {
      setBusy(false);
    }
  }

  const titulo =
    estado?.estado === "CONFIRMADO"
      ? "Pago confirmado"
      : estado?.estado === "RECHAZADO"
        ? "Pago rechazado"
        : estado?.estado === "CANCELADO"
          ? "Pago cancelado"
          : estado?.estado === "EXPIRADO"
            ? "El intento de pago venció"
            : "Estamos verificando tu pago";
  return (
    <main className="retorno-pago">
      {seguimiento.estado ? (
        <ResultadoPago estado={seguimiento.estado} ocupado={seguimiento.consultando}
          error={seguimiento.error} onConsultar={seguimiento.revisar}
          onCancelar={() => void seguimiento.cancelar()}
          onNuevaCompra={() => volver("carrito")} onPedidos={() => volver("pedidos")} />
      ) : (
        <section className="resultado-pago panel">
          <h1>Consultar el pago</h1>
          <p role="status">Estamos verificando el intento de compra.</p>
          {seguimiento.error && <p role="alert">{seguimiento.error}</p>}
          <button type="button" className="btn" disabled={seguimiento.consultando} onClick={seguimiento.revisar}>Consultar de nuevo</button>
        </section>
      )}
      <a href="/" onClick={() => {
        try { sessionStorage.setItem("tl-pantalla-pendiente", "carrito"); } catch { /* Navegación normal disponible. */ }
      }}>Volver a la tienda</a>
    </main>
  );
}