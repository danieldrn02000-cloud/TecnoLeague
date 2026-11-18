import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "./prisma.service";
import { folioPedido } from "./pedido-folio";

//TRANSFORMACIÓN DE UN PEDIDO EN UN CORREO Y PROCESAMIENTO DE SU ENTREGA
type PedidoCorreo = Prisma.PedidoGetPayload<{ include: { detalles: true } }>;
//Cuerpo que necesita resend:
type Mensaje = {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
};
//convierte caracteres especiales en entidades html antes de insertar nombres
const escapar = (valor: string) =>
  valor.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

//presenta dinero en formato MXN
const dinero = (valor: unknown) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(
    Number(valor),
  );

//Construcción del mensaje. Utiliza los datos guarddos del pedido y sus detalles
export function contenidoPedido(pedido: PedidoCorreo, from: string): Mensaje {
  const folio = folioPedido(pedido);
  const fecha = new Intl.DateTimeFormat("es-MX", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "America/Mexico_City",
  }).format(pedido.fecha);

  const guia = folioPedido(pedido);
  const paqueteria = pedido.trackingCarrierName || "PaqueteExpress";
  const pago =
    pedido.metodoPago === "PAGO_AL_RECIBIR"
      ? "Pago al recibir"
      : `Método de pago: ${pedido.metodoPago === "PAYPAL" ? "PayPal" : "Mercado Pago"}`;
  const estado =
    {
      PENDIENTE: "Pendiente",
      PAGADO: "Pagado",
      ENVIADO: "Enviado",
      ENTREGADO: "Entregado",
      CANCELADO: "Cancelado",
    }[pedido.status] || "Recibido";
  const productos = pedido.detalles.map(
    (d) =>
      `${d.cantidad} × ${d.nombreProducto}: ${dinero(Number(d.precioUnitario) * d.cantidad)}`,
  );
  const seguimiento =
    "Consulta Mis pedidos en TecnoLeague para ver el estado del envío. La guía se mostrará cuando sea asignada; este correo confirma la compra, no la salida del paquete.";

  let sitio = "";
  try {
    const url = new URL(process.env.PUBLIC_SITE_URL || "");

    if (url.protocol === "https:" && !url.username && !url.password)
      sitio = url.origin + "/";
  } catch {
    /* El correo también puede enviarse sin un enlace al sitio. */
  }

  return {
    from,
    to: [pedido.email],
    subject: `TecnoLeague: recibimos tu pedido ${folio}`,
    text: [
      `Hola ${pedido.nombre},`,
      `Recibimos tu pedido ${folio}.`,
      `Fecha: ${fecha}`,
      `Estado: ${estado}`,
      pago,
      "Productos:",
      ...productos,
      `Total: ${dinero(pedido.total)} MXN`,
      `Entrega a: ${pedido.nombre}`,
      `Dirección: ${pedido.direccion}`,
      `Paquetería: ${paqueteria}`,
      `Guía: ${guia}`,
      seguimiento,
      ...(sitio ? [sitio] : []),
    ].join("\n"),
    html: `<h1>Recibimos tu pedido ${escapar(folio)}</h1><p>Hola ${escapar(pedido.nombre)}, gracias por tu compra.
    </p><p>Fecha: ${escapar(fecha)}<br>Estado: ${escapar(estado)}<br>${escapar(pago)}</p><ul>${productos.map((p) => 
    `<li>${escapar(p)}</li>`).join("")}</ul><p><strong>Total: ${escapar(dinero(pedido.total))} 
    MXN</strong></p><h2>Datos de entrega</h2><p>Destinatario: ${escapar(pedido.nombre)}<br>Dirección: ${escapar(pedido.direccion)}
    <br>Paquetería: ${escapar(paqueteria)}<br>Guía: ${escapar(guia)}</p><p>${seguimiento}</p>${sitio ? 
      `<p><a href="${escapar(sitio)}">Abrir TecnoLeague</a></p>` : ""}`,
  };
}

@Injectable() //permite registrar la clase como proveedor de NestJs
export class CorreoPedidoService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CorreoPedidoService.name); //registra resultados sin imprimir el contenido del correo
  private timer?: ReturnType<typeof setInterval>; //conserva el temporizador de procesamiento
  private procesando = false; //evita superponer dos recorridos de la cola en la misma instancia

  constructor(private readonly db: PrismaService) {} //proporciona el acceso a la cola y al pedido asociado


  private configuracion() {
    //obtiene api key 
    const apiKey = process.env.RESEND_API_KEY?.trim();
  
    //obtiene correo del remitente
    const from = process.env.PASSWORD_RESET_FROM?.trim();
    return apiKey && from ? { apiKey, from } : null;
  }

  onModuleInit() {
    //si order_email_disabled es 1 entonces no inicia el proceso
    if (process.env.ORDER_EMAIL_DISABLED === "1") return;

    //si la configuracion no funciona entonces marca error
    if (!this.configuracion()) {
      this.logger.warn(
        "Correos de pedidos pendientes: configura RESEND_API_KEY y ORDER_EMAIL_FROM o PASSWORD_RESET_FROM. Reinicia el backend después de configurarlos.",
      );
      return;
    }

    //se crea un intervalo de 30 segundos y solicita tambien un procesamiento inicial
    this.timer = setInterval(() => void this.procesarPendientes(), 30000);
    this.timer.unref(); 
    void this.procesarPendientes();
  }

  //se limpia el intervalo
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  //procesa hasta diez registros por recorrido.
  async procesarPendientes(pedidoId?: number) {
    const config = this.configuracion();
    if (this.procesando || !config) return;
    this.procesando = true;
    
    try {
      const ahora = new Date();
      const pendientes = await this.db.correoPedido.findMany({
        where: {
          ...(pedidoId ? { pedidoId } : {}),
          enviadoEn: null,
          intentos: { lt: 8 },
          proximoIntento: { lte: ahora },
          OR: [{ bloqueadoHasta: null }, { bloqueadoHasta: { lte: ahora } }],
        },
        orderBy: { creadoEn: "asc" },
        take: 10,
      });
    
      for (const correo of pendientes) {
        const bloqueoId = randomUUID();
        const instante = new Date();
        const claim = await this.db.correoPedido.updateMany({
          where: {
            pedidoId: correo.pedidoId,
            enviadoEn: null,
            intentos: correo.intentos,
            proximoIntento: { lte: instante },
            OR: [
              { bloqueadoHasta: null },
              { bloqueadoHasta: { lte: instante } },
            ],
          },
          data: {
            bloqueoId,
            bloqueadoHasta: new Date(Date.now() + 5 * 60000),
            primerIntentoEn: correo.primerIntentoEn || instante,
            intentos: { increment: 1 },
          },
        });
        if (!claim.count) continue;
    
        // Resend conserva claves idempotentes 24 horas. No reenviar automáticamente
        // un resultado incierto después de esa ventana (por ejemplo, tras una caída).
        if (
          correo.primerIntentoEn &&
          Date.now() - correo.primerIntentoEn.getTime() > 23 * 3600000
        ) {
          await this.db.correoPedido.updateMany({
            where: { pedidoId: correo.pedidoId, bloqueoId },
            data: {
              intentos: 8,
              bloqueoId: null,
              bloqueadoHasta: null,
              ultimoError: "REVISAR_RESULTADO_ANTERIOR",
            },
          });
          continue;
        }
    
        let error = "RESEND_NETWORK_ERROR";
        try {
          const registro = await this.db.correoPedido.findUniqueOrThrow({
            where: { pedidoId: correo.pedidoId },
            include: { pedido: { include: { detalles: true } } },
          });
          const mensaje = registro.contenido
            ? (registro.contenido as unknown as Mensaje)
            : contenidoPedido(registro.pedido, config.from);
    
            const guardado = await this.db.correoPedido.updateMany({
            where: { pedidoId: correo.pedidoId, bloqueoId },
            data: { contenido: mensaje as unknown as Prisma.InputJsonValue },
          });
    
          if (!guardado.count) continue;
          const response = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${config.apiKey}`,
              "Content-Type": "application/json",
              "Idempotency-Key": `pedido-confirmacion-${registro.pedido.claveSolicitud}`,
            },
    
            // JSONB puede cambiar el orden de las claves. Serializar siempre en
            // el mismo orden mantiene también idénticos los bytes del reintento.
            body: JSON.stringify({
              from: mensaje.from,
              to: mensaje.to,
              subject: mensaje.subject,
              text: mensaje.text,
              html: mensaje.html,
            }),
            signal: AbortSignal.timeout(15000),
          });
    
          await response.body?.cancel();
          if (!response.ok) {
            error = `RESEND_HTTP_${response.status}`;
            throw new Error();
          }
    
          await this.db.correoPedido.updateMany({
            where: { pedidoId: correo.pedidoId, bloqueoId },
            data: {
              enviadoEn: new Date(),
              bloqueoId: null,
              bloqueadoHasta: null,
              ultimoError: null,
            },
          });
          this.logger.log({
            pedidoId: correo.pedidoId,
            resultado: "CORREO_ENVIADO",
          });
          continue;
        } catch {
          /* Guardar un fallo de entrega nunca revierte un pedido o pago. */
        }
    
        await this.db.correoPedido.updateMany({
          where: { pedidoId: correo.pedidoId, bloqueoId },
          data: {
            bloqueoId: null,
            bloqueadoHasta: null,
            ultimoError: error,
            proximoIntento: new Date(
              Date.now() + Math.min(2 ** correo.intentos * 60000, 3600000),
            ),
          },
        });
        this.logger.warn({ pedidoId: correo.pedidoId, resultado: error });
      }
    } catch {
      this.logger.error(
        "No se pudo procesar la cola de correos de pedidos. Se reintentará sin modificar los pedidos.",
      );
    } finally {
      this.procesando = false;
    }
  }
}
