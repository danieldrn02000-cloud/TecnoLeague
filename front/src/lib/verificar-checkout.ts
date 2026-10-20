import { graphql, GraphQLError } from "../api";
import {
  aplicarCompraConfirmada,
  CONSULTAR_INTENTO,
  guardarIntento,
  leerIntento,
  olvidarIntento,
  type EstadoCheckout,
} from "./checkout";

type VerificacionCheckout = {
  pendiente: string | null;
  aviso: string;
  estado: EstadoCheckout | null;
};

// El almacenamiento conserva una referencia para recuperarse de un timeout;
// solo el backend puede decidir si existe un pago todavía en proceso.
export async function verificarCheckout(usuarioId: number): Promise<VerificacionCheckout> {
  let aviso = "";
  let ultimoEstado: EstadoCheckout | null = null;

  async function resolver(id: string): Promise<string | null> {
    let estado: EstadoCheckout;
    try {
      const respuesta = await graphql<{ estadoIntento: EstadoCheckout }>(CONSULTAR_INTENTO, { id });
      estado = respuesta.estadoIntento;
      ultimoEstado = estado;
    } catch (error) {
      if (!(error instanceof GraphQLError) || error.code !== "NOT_FOUND") throw error;
      // Un fallo de conexión NO es evidencia de que el intento no existe.
      olvidarIntento(usuarioId, id);
      return null;
    }
    if (estado.estado === "INICIADO" || estado.estado === "EN_PROCESO") {
      guardarIntento(usuarioId, id);
      aviso = estado.aviso ?? "";
      return id;
    }
    if (estado.estado === "CONFIRMADO") {
      await aplicarCompraConfirmada(usuarioId, estado);
      aviso = `Tu pago anterior está confirmado: pedido #${estado.pedidoId}. Puedes verlo en Mis pedidos.`;
    } else {
      aviso = "El intento anterior terminó. Conservamos tu carrito y puedes volver a pagar.";
    }
    olvidarIntento(usuarioId, id);
    return null;
  }

  const local = leerIntento(usuarioId);
  if (local) {
    const pendiente = await resolver(local);
    if (pendiente) return { pendiente, aviso, estado: ultimoEstado };
  }
  // También detecta intentos abiertos en otra pestaña o dispositivo y no
  // confunde un ID local antiguo con un pago actualmente activo.
  const { intentoActivo } = await graphql<{ intentoActivo: string | null }>("{intentoActivo}");
  const pendiente = intentoActivo ? await resolver(intentoActivo) : null;
  return { pendiente, aviso, estado: ultimoEstado };
}
