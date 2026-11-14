//Mostrar aprobado, pendiente, rechazado, cancelado o vencido, con las acciones disponibles
import {
  intentoTerminado,
  puedePagarIntento,
  type EstadoCheckout,
} from "../lib/checkout";
import { urlPayPalValida } from "../lib/paypal";

type Props = {
  estado: EstadoCheckout;
  ocupado?: boolean;
  pausado?: boolean;
  error?: string;
  onConsultar: () => void;
  onCancelar: () => void;
  onNuevaCompra: () => void;
  onPedidos: () => void;
};

export function ResultadoPago({
  estado,
  ocupado,
  pausado,
  error,
  onConsultar,
  onCancelar,
  onNuevaCompra,
  onPedidos,
}: Props) {
  const terminado = intentoTerminado(estado);
  const aprobado = estado.estado === "CONFIRMADO";
  const reserva = puedePagarIntento(estado);
  const titulos = {
    INICIADO:
      estado.modalidad === "PAYPAL"
        ? "Preparando tu pago con PayPal"
        : reserva
          ? "Tu compra está preparada"
          : "Estamos verificando tu pago",
    EN_PROCESO:
      estado.modalidad === "PAYPAL" && estado.checkoutUrl
        ? "Completa tu pago con PayPal"
        : estado.autenticacion
          ? "Autoriza el pago con tu banco"
          : "Estamos verificando tu pago",
    CONFIRMADO: "Pago aprobado",
    RECHAZADO: estado.solicitudRechazada
      ? "No se pudo iniciar el pago"
      : "Pago rechazado",
    CANCELADO: "Pago cancelado",
    EXPIRADO: "El tiempo para pagar terminó",
  };
  return (
    <section className="resultado-pago panel" aria-label="Resultado del pago">
      <h2 aria-live="polite">{titulos[estado.estado]}</h2>
      <p>
        {aprobado
          ? `Tu pedido #${estado.pedidoId} está pagado.`
          : terminado
            ? "Conservamos tu carrito. Puedes preparar una nueva compra."
            : estado.modalidad === "PAYPAL" && estado.checkoutUrl
              ? "Continúa con PayPal para autorizar tu compra. Volverás aquí al terminar."
              : reserva
                ? "Completa los datos de tu tarjeta para pagar."
                : "Espera la confirmación antes de volver a pagar."}
      </p>
      <p>
        Total: ${estado.total} {estado.moneda}
      </p>
      {estado.aviso && <p role="status">{estado.aviso}</p>}
      {error && <p role="alert">{error}</p>}
      {pausado && !terminado && (
        <p role="status">
          Tu pago sigue pendiente. Pulsa «Consultar estado» para buscar una
          actualización.
        </p>
      )}

      {!terminado && estado.autenticacion && (
        <div className="autenticacion-pago">
          <p>
            Completa la verificación solicitada por tu banco. Después
            comprobaremos el resultado.
          </p>
          <iframe
            src={estado.autenticacion.url}
            title="Autenticación bancaria del pago"
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          />
          <p>
            Si la verificación no aparece, puedes{" "}
            <a
              href={estado.autenticacion.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              abrir la verificación del banco en otra pestaña
            </a>{" "}
            y después consultar el pago aquí.
          </p>
        </div>
      )}

      <div className="resultado-pago-acciones">
        {!terminado &&
          estado.modalidad === "PAYPAL" &&
          estado.checkoutUrl &&
          urlPayPalValida(estado.checkoutUrl) && (
            <a className="btn" href={estado.checkoutUrl}>
              Continuar con PayPal
            </a>
          )}
        {aprobado && (
          <button type="button" className="btn" onClick={onPedidos}>
            Ver mis pedidos
          </button>
        )}
        {terminado && !aprobado && (
          <button type="button" className="btn" onClick={onNuevaCompra}>
            Volver a intentar
          </button>
        )}
        {(!terminado || error) && (
          <button
            type="button"
            className="text-btn"
            disabled={ocupado}
            onClick={onConsultar}
          >
            {ocupado ? "Consultando…" : "Consultar estado"}
          </button>
        )}
        {!terminado && !estado.autenticacion && (
          <button
            type="button"
            className="text-btn"
            disabled={ocupado}
            onClick={onCancelar}
          >
            Cancelar compra
          </button>
        )}
        {!terminado &&
          estado.modalidad === "REDIRECCION" &&
          estado.checkoutUrl && (
            <a href={estado.checkoutUrl}>
              Continuar el pago anterior en Mercado Pago
            </a>
          )}
      </div>
    </section>
  );
}
