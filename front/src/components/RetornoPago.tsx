import { useEffect, useRef, useState } from "react";
import { graphql, GraphQLError } from "../api";
import {
  aplicarCompraConfirmada,
  CONSULTAR_INTENTO,
  olvidarIntento,
  type EstadoCheckout,
} from "../lib/checkout";

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
    <main
      className="panel"
      style={{ maxWidth: 680, margin: "60px auto", padding: 28 }}
    >
      <h1>{titulo}</h1>
      <p aria-live="polite">
        {estado?.estado === "CONFIRMADO"
          ? `Tu pedido #${estado.pedidoId} se creó después de verificar el pago con Mercado Pago.`
          : "Conservamos tu carrito. El regreso de Mercado Pago por sí solo no confirma una compra."}
      </p>
      <p>
        Referencia del intento: <code>{intentoId}</code>
      </p>
      {error && <p role="alert">{error}</p>}
      {!finalizado.current && (
        <button
          className="btn"
          disabled={busy}
          onClick={() => setRevision((n) => n + 1)}
        >
          {busy ? "Consultando…" : "Consultar de nuevo"}
        </button>
      )}
      {!finalizado.current && estado?.checkoutUrl && (
        <p>
          <a href={estado.checkoutUrl}>Continuar el pago en Mercado Pago</a>
          {" · "}
          <button
            className="text-btn"
            disabled={busy}
            onClick={() => void cancelar()}
          >
            Cancelar este intento
          </button>
        </p>
      )}
      {noExiste && (
        <p>
          El servidor no tiene registrado este intento. Puedes
          <a href="/" onClick={() => olvidarIntento(usuarioId, intentoId)}>
            {" "}
            volver a la tienda y reintentar
          </a>
          .
        </p>
      )}
      <p>
        <a
          href="/"
          onClick={() => {
            try {
              sessionStorage.setItem(
                "tl-pantalla-pendiente",
                estado?.estado === "CONFIRMADO" ? "pedidos" : "carrito",
              );
            } catch {
              /* Navegación normal disponible. */
            }
          }}
        >
          {estado?.estado === "CONFIRMADO"
            ? "Ver mis pedidos"
            : "Volver a mi carrito"}
        </a>
      </p>
      {!finalizado.current && (
        <p>
          No inicies otro pago mientras se verifica este intento. Puedes volver
          a consultar esta página.
        </p>
      )}
    </main>
  );
}
