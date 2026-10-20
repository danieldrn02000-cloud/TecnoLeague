import { EventosService, EventoBackOffice } from "./eventos.service";
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import { EstadoIntento, Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "./prisma.service";
import { fallo } from "./tienda.service";
import type {DatosPagoInput, PedidoInput} from "./types"
import { ErrorOrdersMP, MercadoPagoOrdersService, type OrdenMP } from "./mercadopago-orders.service";

type RecursoMP = {
  id?: string | number;
  checkout_url?: string;
  status?: string;
  status_detail?: string;
  currency?: string;
  country_code?:string;
  total_amount?: string;
  total_paid_amount?: string;
  external_reference?: string;
  user_id?: string | number;
  collector_id?: string | number;
  order?: { id?: string | number };
  last_updated_date?: string;
  transactions?: OrdenMP["transactions"];
};

const incluirIntento = { detalles: true, pago: true, operaciones: true } as const;
type Intento = Prisma.IntentoCompraGetPayload<{
  include: typeof incluirIntento;
}>;
const pendientes: EstadoIntento[] = ["INICIADO", "EN_PROCESO"];
const MINUTOS_RESERVA = 15;

@Injectable()
export class PagosService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PagosService.name);
  private timer?: ReturnType<typeof setInterval>;
  private revisando = false;
  constructor(
    private readonly db: PrismaService,
    private readonly eventos: EventosService,
    private readonly orders: MercadoPagoOrdersService,
  ) {}

  // Acumula avisos durante la transacción y publica solamente si el commit termina.
  private async conEventos<T>(
    trabajo: (
      tx: Prisma.TransactionClient,
      emitir: (
        evento: Pick<EventoBackOffice, "entidad" | "entidadId" | "accion">,
      ) => void,
    ) => Promise<T>,
    opciones: { maxWait?: number; timeout?: number },
  ): Promise<T> {
    const avisos: Pick<EventoBackOffice, "entidad" | "entidadId" | "accion">[] =
      [];
    const resultado = await this.db.$transaction(
      (tx) => trabajo(tx, (e) => avisos.push(e)),
      opciones,
    );
    for (const aviso of avisos) await this.eventos.publicarBackOffice(aviso);
    return resultado;
  }

  onModuleInit() {
    // Un proceso Nest persistente concilia también si nadie regresa del checkout.
    if (process.env.MP_RECONCILIATION_DISABLED === "1") return;
    this.timer = setInterval(() => void this.revisarPendientes(), 60_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private configuracion() {
    const token = process.env.MP_ACCESS_TOKEN;
    const collector = process.env.MP_COLLECTOR_ID;
    if (!token || !collector || !/^\d+$/.test(collector)) {
      fallo("Configura MP_ACCESS_TOKEN y MP_COLLECTOR_ID en el backend.");
    }
    return { token, collector };
  }

  private urlConfigurada(nombre: string) {
    const valor = process.env[nombre];
    if (!valor) fallo(`Configura ${nombre} en el backend.`);
    let url: URL;
    try {
      url = new URL(valor);
    } catch {
      return fallo(`${nombre} no es una URL válida.`);
    }
    if (
      url.username ||
      url.password ||
      url.hash ||
      url.search ||
      (url.protocol !== "https:" &&
        !(
          nombre === "MP_RETURN_BASE_URL" &&
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(url.hostname)
        ))
    ) {
      fallo(
        `${nombre} debe ser una URL HTTPS pública (retorno local HTTP permitido).`,
      );
    }
    return url.href.replace(/\/$/, "");
  }

  private async reservarCompra(
    datos: PedidoInput,
    usuarioId: number,
    modalidad: "REDIRECCION" | "ORDERS_API",
  ){
    const retornoBase = modalidad ==="REDIRECCION" ? this.urlConfigurada("MP_RETURN_BASE_URL"):null;
    const callback= modalidad === "REDIRECCION" ? this.urlConfigurada("MP_WEBHOOK_URL"):null;

    if (
      datos.nombre.trim().length < 2 ||
      datos.nombre.length > 120 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.email) ||
      datos.email.length > 150 ||
      datos.direccion.trim().length < 10 ||
      datos.direccion.length > 500 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        datos.claveSolicitud,
      )
    ) {
      fallo("Revisa los datos de entrega y la clave de la solicitud.");
    }
    if (!datos.renglones.length || datos.renglones.length > 50)
      fallo("El carrito debe contener de 1 a 50 renglones.");
    const cantidades = new Map<number, number>();
    for (const linea of datos.renglones) {
      if (
        !Number.isInteger(linea.productoId) ||
        linea.productoId < 1 ||
        !Number.isInteger(linea.cantidad) ||
        linea.cantidad < 1 ||
        linea.cantidad > 99
      )
        fallo("Renglón inválido.");
      cantidades.set(
        linea.productoId,
        (cantidades.get(linea.productoId) ?? 0) + linea.cantidad,
      );
    }
    if ([...cantidades.values()].some((n) => n > 99))
      fallo("Máximo 99 unidades por producto.");
    const renglones = [...cantidades].sort((a, b) => a[0] - b[0]);
    const contacto = {
      nombre: datos.nombre.trim(),
      email: datos.email.trim().toLowerCase(),
      direccion: datos.direccion.trim(),
    };
    const huella = createHash("sha256")
      .update(JSON.stringify({ usuarioId, ...contacto, renglones }))
      .digest("hex");
    const intento = await this.conEventos(
      async (tx, emitir) => {
        // La misma clave concurrente reserva una sola vez, incluso entre instancias.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(7241, hashtext(${datos.claveSolicitud}))::text`;
        const previo = await tx.intentoCompra.findUnique({
          where: { claveSolicitud: datos.claveSolicitud },
          include: incluirIntento,
        });
        if (previo) {
          if (
            previo.usuarioId !== usuarioId ||
            previo.huellaSolicitud !== huella ||
            previo.modalidad !== modalidad
          )
            fallo("La solicitud ya se utilizó con otros datos.");
          return previo;
        }
        // No permite pagar dos veces el mismo carrito por una pestaña o reintento nuevo.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(7242, ${usuarioId}::int)::text`;
        const abierto = await tx.intentoCompra.findFirst({
          where: { usuarioId, estado: { in: pendientes } },
        });
        if (abierto)
          fallo(
            `Ya tienes un pago en proceso. Revisa el intento ${abierto.id} antes de iniciar otro.`,
          );
        const id = datos.claveSolicitud;
        let total = new Prisma.Decimal(0);
        const detalles = [];
        for (const [productoId, cantidad] of renglones) {
          const cambio = await tx.producto.updateMany({
            where: { id: productoId, activo: true, stock: { gte: cantidad } },
            data: { stock: { decrement: cantidad } },
          });
          if (!cambio.count)
            fallo(`El producto ${productoId} no tiene stock suficiente.`);
          const producto = await tx.producto.findUniqueOrThrow({
            where: { id: productoId },
          });
          total = total.add(producto.precio.mul(cantidad));
          detalles.push({
            productoId,
            cantidad,
            precioUnitario: producto.precio,
            nombreProducto: producto.nombre,
          });
        }
        if (!total.gt(0)) fallo("El importe debe ser positivo.");
        const retorno = `${retornoBase}/pago/retorno?intento=${id}`;
        const payload =modalidad ==="REDIRECCION"? {
          type: "online",
          processing_mode: "manual",
          currency: "MXN",
          total_amount: total.toFixed(2),
          external_reference: `TL-INTENTO-${id}`,
          expiration_time: `PT${MINUTOS_RESERVA}M`,
          items: detalles.map((d) => ({
            title: d.nombreProducto,
            quantity: d.cantidad,
            unit_price: d.precioUnitario.toFixed(2),
          })),
          config: {
            online: {
              callback_url: callback,
              success_url: retorno,
              failure_url: retorno,
              pending_url: retorno,
              auto_return: "all",
              retries: { allowed: false },
            },
          },
        }:undefined;

        const nuevo = await tx.intentoCompra.create({
          data: {
            id,
            usuarioId,
            modalidad,
            ...contacto,
            claveSolicitud: datos.claveSolicitud,
            huellaSolicitud: huella,
            total,
            expiraEn: new Date(Date.now() + MINUTOS_RESERVA * 60_000),
            checkoutPayload: payload,
            detalles: { create: detalles },
            pago: {
              create: {
                proveedor: "MERCADO_PAGO",
                monto: total,
                moneda: "MXN",
                claveIdempotencia: id,
              },
            },
          },
          include: incluirIntento,
        });
        await tx.movimientoInventario.createMany({
          data: detalles.map((d) => ({
            productoId: d.productoId,
            usuarioId,
            tipo: "RESERVA",
            cantidad: -d.cantidad,
            motivo: `Reserva de checkout ${id}`,
          })),
        });
        if (nuevo.pago)
          emitir({
            entidad: "PAGO",
            entidadId: nuevo.pago.id,
            accion: "CREADO",
          });
        for (const d of detalles)
          emitir({
            entidad: "INVENTARIO",
            entidadId: d.productoId,
            accion: "ACTUALIZADO",
          });
        return nuevo;
      },
      { maxWait: 10000, timeout: 15000 },
    );
    return intento;
  }

  
  async prepararCompra(datos: PedidoInput, usuarioId: number) {
    const intento = await this.reservarCompra(datos, usuarioId, "ORDERS_API");
    return this.consultarIntento(intento.id, usuarioId);
  }

  async procesarPago(id: string, datos: DatosPagoInput, usuarioId: number) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(datos.claveOperacion) ||
      !/^[a-zA-Z0-9_-]{1,200}$/.test(datos.token) ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(datos.metodoPagoId) ||
      !["credit_card", "debit_card"].includes(datos.tipoMetodoPago) ||
      !Number.isInteger(datos.cuotas) || datos.cuotas < 1 || datos.cuotas > 36 ||
      (datos.tipoMetodoPago === "debit_card" && datos.cuotas !== 1) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.email) || datos.email.length > 150 ||
      (datos.identificacion && (
        !/^[a-zA-Z0-9_-]{1,30}$/.test(datos.identificacion.tipo) ||
        !/^[a-zA-Z0-9 .-]{1,40}$/.test(datos.identificacion.numero)
      ))
    ) fallo("Revisa los datos de pago y la clave de la operación.");

    this.configuracion();
    if (!process.env.MP_WEBHOOK_SECRET) fallo("Configura MP_WEBHOOK_SECRET en el backend.");

    // Solo se persiste el digest; nunca el token ni el documento. Permite
    // recuperar una solicitud incierta con exactamente el mismo payload.
    const huella = createHash("sha256").update(JSON.stringify({
      token: datos.token,
      metodoPagoId: datos.metodoPagoId,
      tipoMetodoPago: datos.tipoMetodoPago,
      cuotas: datos.cuotas,
      email: datos.email.trim().toLowerCase(),
      identificacion: datos.identificacion ? {
        tipo: datos.identificacion.tipo, numero: datos.identificacion.numero,
      } : null,
    })).digest("hex");

    // El registro se confirma ANTES de hacer HTTP. Dos solicitudes concurrentes
    // nunca pueden iniciar dos cobros para una misma reserva.
    const preparada = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM intentos_compra WHERE id = ${id} FOR UPDATE`;
      const intento = await tx.intentoCompra.findFirst({
        where: { id, usuarioId }, include: incluirIntento,
      });
      if (!intento) fallo("Intento no encontrado.", "NOT_FOUND");
      if (intento.modalidad !== "ORDERS_API") fallo("Este intento utiliza el checkout anterior.");
      const repetida = await tx.operacionCobro.findUnique({
        where: { claveSolicitud: datos.claveOperacion },
      });
      if (repetida && repetida.intentoId !== id) fallo("La clave de operación ya se utilizó.");
      if (intento.operaciones.length) {
        const operacion = intento.operaciones[0];
        // Acotar los reenvíos: no asumir que MP conserva la idempotencia para siempre.
        const dentroDeVentana = operacion.creadoEn.getTime() > Date.now() - MINUTOS_RESERVA * 60_000;
        const recuperable = dentroDeVentana && (operacion.estado === "INCIERTA" ||
          (operacion.estado === "ENVIADA" && operacion.actualizadoEn.getTime() < Date.now() - 60_000));
        if (repetida && recuperable && !operacion.idOrdenExterna && pendientes.includes(intento.estado)) {
          if (operacion.huellaSolicitud !== huella) {
            fallo("La operación incierta requiere la misma clave y los mismos datos de pago. Consulta su resultado.");
          }
          await tx.operacionCobro.update({ where: { id: operacion.id }, data: { estado: "ENVIADA" } });
          return { intento, operacion, enviar: true, reenvio: true };
        }
        return { intento, operacion, enviar: false, reenvio: false };
      }
      if (!pendientes.includes(intento.estado) || !intento.reservaActiva || intento.expiraEn <= new Date()) {
        fallo("La reserva terminó. Consulta el intento antes de preparar otra compra.");
      }
      const operacionId = randomUUID();
      const operacion = await tx.operacionCobro.create({ data: {
        id: operacionId,
        intentoId: id,
        claveSolicitud: datos.claveOperacion,
        claveIdempotencia: operacionId,
        huellaSolicitud: huella,
        modoCaptura: "automatic_async",
      } });
      await tx.intentoCompra.update({ where: { id }, data: { estado: "EN_PROCESO" } });
      return { intento, operacion, enviar: true, reenvio: false };
    }, { maxWait: 10000, timeout: 15000 });

    if (preparada.enviar) {
      try {
        const orden = await this.orders.crearYProcesarOrden({
          modoCaptura: preparada.operacion.modoCaptura,
          total: preparada.intento.total.toFixed(2),
          referenciaExterna: `TL-OP-${preparada.operacion.id}`,
          claveIdempotencia: preparada.operacion.claveIdempotencia,
          token: datos.token,
          metodoPagoId: datos.metodoPagoId,
          tipoMetodoPago: datos.tipoMetodoPago,
          cuotas: datos.cuotas,
          email: datos.email.trim().toLowerCase(),
          identificacion: datos.identificacion ?? undefined,
        });
        await this.vincularOrdenApi(preparada.operacion.id, orden);
      } catch (error) {
        if (error instanceof ErrorOrdersMP) {
          this.logger.error(JSON.stringify({
            intentoId: id, operacionId: preparada.operacion.id,
            resultado: "ERROR_CREAR_ORDEN_MP", http: error.httpProveedor,
            codigo: error.diagnostico.codigo, causas: error.diagnostico.causas,
            requestId: error.diagnostico.requestId, reenvio: preparada.reenvio,
          }));
        }
        // Un error del REENVÍO no demuestra que la primera llamada no cobró.
        const rechazado = !preparada.reenvio && error instanceof ErrorOrdersMP && error.rechazadoDefinitivo;
        await this.db.operacionCobro.updateMany({
          where: { id: preparada.operacion.id, estado: "ENVIADA" },
          data: {
            estado: rechazado ? "FINALIZADA" : "INCIERTA",
            estadoProveedor: rechazado ? `HTTP_${error.httpProveedor}` : undefined,
          },
        });
        if (rechazado) {
          await this.db.intentoCompra.updateMany({
            where: { id, estado: { in: pendientes } },
            data: { ultimoError: `No se pudo iniciar el pago. ${error.message}` },
          });
          return this.consultarIntento(id, usuarioId);
        }
        await this.registrarFallo(id, error);
        // No guardar el token. El webhook recupera la orden; un reenvío explícito
        // solo acepta la misma clave y el mismo payload con idempotencia MP.
        throw new ServiceUnavailableException("No se pudo confirmar el cobro. Consulta el mismo intento; no inicies otro pago.");
      }
    }
    return this.consultarIntento(id, usuarioId);
  }

  private async vincularOrdenApi(operacionId: string, orden: RecursoMP) {
    const operacion = await this.db.operacionCobro.findUnique({ where: { id: operacionId } });
    if (!operacion) throw new ServiceUnavailableException("Operación de cobro no encontrada.");
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM intentos_compra WHERE id = ${operacion.intentoId} FOR UPDATE`;
      const intento = await tx.intentoCompra.findUniqueOrThrow({
        where: { id: operacion.intentoId }, include: incluirIntento,
      });
      this.verificarOrden(orden, intento);
      if (!intento.pago) throw new ServiceUnavailableException("Intento sin registro de pago.");
      await tx.operacionCobro.updateMany({
        where: { id: operacionId, estado: { not: "FINALIZADA" } },
        data: { idOrdenExterna: String(orden.id), estado: "VINCULADA", estadoProveedor: orden.status },
      });
      await tx.pago.update({
        where: { id: intento.pago.id }, data: { idOrdenExterna: String(orden.id) },
      });
    });
  }

  async iniciarPago(datos: PedidoInput, usuarioId: number) {
    this.configuracion();
    if (!process.env.MP_WEBHOOK_SECRET) fallo("Configura MP_WEBHOOK_SECRET en el backend.");
    const intento = await this.reservarCompra(datos, usuarioId, "REDIRECCION");
    if (!pendientes.includes(intento.estado))
      fallo(
        "Este intento ya terminó. Consulta su resultado antes de volver a comprar.",
      );
    await this.prepararOrden(intento.id);
    // Resuelve también una aprobación ocurrida antes de recuperar el checkout.
    const resultado = await this.consultarIntento(intento.id, usuarioId);
    const actualizado = await this.db.intentoCompra.findUniqueOrThrow({
      where: { id: intento.id },
      include: incluirIntento,
    });
    return {
      intentoId: intento.id,
      checkoutUrl: pendientes.includes(actualizado.estado)
        ? actualizado.checkoutUrl
        : null,
      estado: resultado.estado,
      pedidoId: resultado.pedidoId,
    };
  }

  private verificarOrden(orden: RecursoMP, intento: Intento) {
    const { collector } = this.configuracion();
    if (
      !orden.id ||
      String(orden.user_id) !== collector ||
      !(orden.currency === intento.moneda ||
        (intento.modalidad === "ORDERS_API" && !orden.currency && orden.country_code === "MEX" && intento.moneda === "MXN")) ||
      orden.external_reference !== (intento.modalidad === "ORDERS_API"
        ? `TL-OP-${intento.operaciones[0]?.id}` : `TL-INTENTO-${intento.id}`) ||
      !this.importeValido(orden.total_amount, intento.total) ||
      (intento.pago?.idOrdenExterna &&
        String(orden.id) !== intento.pago.idOrdenExterna)
    ) {
      throw new ServiceUnavailableException(
        "La orden no coincide con el intento, vendedor, moneda o importe.",
      );
    }
  }

  private async prepararOrden(id: string) {
    // Guarda exactamente el payload antes de la llamada externa. Un timeout se
    // resuelve reenviándolo con la MISMA clave, nunca creando otro cobro.
    await this.conEventos(
      async (tx, emitir) => {
        await tx.$queryRaw`SELECT id FROM intentos_compra WHERE id = ${id} FOR UPDATE`;
        const intento = await tx.intentoCompra.findUniqueOrThrow({
          where: { id },
          include: incluirIntento,
        });
        //Las consultas del nuevo flujo nunca crean ni reenvian cobros
        if(intento.modalidad==="ORDERS_API") return;
        if (
          intento.pago?.idOrdenExterna ||
          !pendientes.includes(intento.estado)
        )
          return;
        if (!intento.pago || !intento.checkoutPayload)
          throw new ServiceUnavailableException("Intento incompleto.");
        const orden = await this.solicitar(
          "/v1/orders",
          "POST",
          intento.checkoutPayload,
          intento.id,
        );
        this.verificarOrden(orden, intento);
        const url = new URL(orden.checkout_url ?? "https://invalid.invalid");
        if (
          url.protocol !== "https:" ||
          !["www.mercadopago.com.mx", "sandbox.mercadopago.com.mx"].includes(
            url.hostname,
          ) ||
          url.username ||
          url.password
        ) {
          throw new ServiceUnavailableException(
            "Mercado Pago no devolvió una URL de checkout válida para México.",
          );
        }
        await tx.pago.update({
          where: { id: intento.pago.id },
          data: {
            idOrdenExterna: String(orden.id),
            estadoProveedor: orden.status,
          },
        });
        await tx.intentoCompra.update({
          where: { id },
          data: { checkoutUrl: url.href, ultimoError: null },
        });
        emitir({
          entidad: "PAGO",
          entidadId: intento.pago.id,
          accion: "ACTUALIZADO",
        });
      },
      { maxWait: 10000, timeout: 25000 },
    );
  }

  private importeValido(valor: unknown, esperado: Prisma.Decimal) {
    return (
      typeof valor === "string" &&
      /^\d+(\.\d{1,2})?$/.test(valor) &&
      new Prisma.Decimal(valor).equals(esperado)
    );
  }

  async intentoActivo(usuarioId: number) {
    return (
      (
        await this.db.intentoCompra.findFirst({
          where: { usuarioId, estado: { in: pendientes } },
          orderBy: { creadoEn: "desc" },
          select: { id: true },
        })
      )?.id ?? null
    );
  }

  async cancelarIntento(id: string, usuarioId: number) {
    const intento = await this.db.intentoCompra.findFirst({
      where: { id, usuarioId },
    });
    if (!intento) fallo("Intento no encontrado.", "NOT_FOUND");
    if (pendientes.includes(intento.estado)) {
      try {
        await this.prepararOrden(id);
        await this.conciliar(id, true);
      } catch (error) {
        await this.registrarFallo(id, error);
        throw error;
      }
    }
    return this.consultarIntento(id, usuarioId);
  }

  async consultarIntento(id: string, usuarioId: number) {
    const intento = await this.db.intentoCompra.findFirst({
      where: { id, usuarioId },
      include: incluirIntento,
    });
    if (!intento) fallo("Intento no encontrado.", "NOT_FOUND");
    let aviso: string | null = null;
    let autenticacion: { url: string } | null = null;
    if (pendientes.includes(intento.estado)) {
      try {
        await this.prepararOrden(id);
        autenticacion = (await this.conciliar(id)).autenticacion;
      } catch (error) {
        aviso =
          "No pudimos verificar el pago todavía. Conservamos el carrito; vuelve a consultar este intento.";
        await this.registrarFallo(id, error);
      }
    }
    const actual = await this.db.intentoCompra.findUniqueOrThrow({
      where: { id },
      include: { detalles: true, operaciones:true, pago: true },
    });
    const operacion = actual.operaciones[0];
    const solicitudRechazada = actual.estado === "RECHAZADO" && !!operacion?.estadoProveedor?.startsWith("HTTP_");
    if (!aviso && solicitudRechazada) {
      aviso = actual.ultimoError ?? "No se pudo iniciar el pago. Revisa la configuración de Mercado Pago.";
    } else if (!aviso && pendientes.includes(actual.estado) && operacion && !actual.pago?.idOrdenExterna) {
      aviso = operacion.estado === "ENVIADA"
        ? "Estamos esperando la respuesta del pago. No inicies otro cobro."
        : "Aún no conocemos el resultado. Conservamos el intento y lo verificaremos sin crear otro cobro.";
    }
    return {
      intentoId: id,
      total:actual.total.toFixed(2),
      moneda: actual.moneda,
      modalidad: actual.modalidad,
      autenticacion: pendientes.includes(actual.estado) ? autenticacion : null,
      operacionId: actual.operaciones[0]?.id ?? null,
      estadoOperacion: actual.operaciones[0]?.estado ?? null,
      estado: actual.estado,
      pedidoId: actual.pedidoId,
      expiraEn: actual.expiraEn.toISOString(),
      aviso,
      solicitudRechazada,
      checkoutUrl: pendientes.includes(actual.estado)
        ? actual.checkoutUrl
        : null,
      renglones: actual.detalles.map((d) => ({
        productoId: d.productoId,
        cantidad: d.cantidad,
      })),
    };
  }

  async procesarWebhook(tipo: string, recursoId: string) {
    if (!["order", "payment", "merchant_order"].includes(tipo)) {
      this.logger.log(
        JSON.stringify({ tipo, recursoId, resultado: "IGNORADO_TIPO" }),
      );
      return { resultado: "IGNORADO_TIPO" };
    }
    // payment y merchant_order son señales: jamás aprobar a partir de sus cuerpos.
    const ruta =
      tipo === "order"
        ? `/v1/orders/${encodeURIComponent(recursoId)}`
        : tipo === "payment"
          ? `/v1/payments/${encodeURIComponent(recursoId)}`
          : `/merchant_orders/${encodeURIComponent(recursoId)}`;
    const recurso = await this.solicitar(ruta);
    if (String(recurso.id) !== recursoId)
      throw new ServiceUnavailableException("ID del recurso no coincide.");
    const referencia = recurso.external_reference;
    let intento =
      tipo === "order"
        ? await this.db.intentoCompra.findFirst({
            where: { pago: { is: { idOrdenExterna: recursoId } } },
          })
        : null;
    if (!intento && tipo === "payment" && recurso.order?.id) {
      intento = await this.db.intentoCompra.findFirst({
        where: { pago: { is: { idOrdenExterna: String(recurso.order.id) } } },
      });
    }
    if (!intento && referencia?.startsWith("TL-INTENTO-")) {
      intento = await this.db.intentoCompra.findUnique({
        where: { id: referencia.slice("TL-INTENTO-".length) },
      });
    }
    if (!intento && tipo === "order" && referencia?.startsWith("TL-OP-")) {
      const operacion = await this.db.operacionCobro.findUnique({
        where: { id: referencia.slice("TL-OP-".length) },
      });
      if (!operacion) throw new ServiceUnavailableException("Operación aún no disponible; reintentar.");
      // Recupera incluso si MP cobró pero se perdió la respuesta del POST.
      await this.vincularOrdenApi(operacion.id, recurso);
      intento = await this.db.intentoCompra.findUnique({ where: { id: operacion.intentoId } });
    }
    if (!intento) {
      // Compatibilidad con órdenes vinculadas a pedidos anteriores a esta migración.
      const legacy =
        tipo === "order"
          ? await this.db.pago.findUnique({
              where: { idOrdenExterna: recursoId },
            })
          : null;
      if (legacy?.pedidoId && !legacy.intentoId)
        return this.conciliarLegacy(recursoId);
      if (referencia?.startsWith("TL-INTENTO-"))
        throw new ServiceUnavailableException(
          "Intento aún no disponible; reintentar.",
        );
      this.logger.log(
        JSON.stringify({ tipo, recursoId, resultado: "IGNORADO_AJENO" }),
      );
      return { resultado: "IGNORADO_AJENO" };
    }
    try {
      await this.prepararOrden(intento.id);
      const { resultado } = await this.conciliar(intento.id);
      this.logger.log(
        JSON.stringify({ tipo, recursoId, intentoId: intento.id, resultado }),
      );
      return { resultado, intentoId: intento.id };
    } catch (error) {
      await this.registrarFallo(intento.id, error);
      throw error;
    }
  }

  private autenticacionOrden(orden: RecursoMP): { url: string } | null {
    for (const pago of orden.transactions?.payments ?? []) {
      const seguridad = pago.payment_method?.transaction_security;
      const direccion = seguridad?.url ?? (orden.status === "action_required" ? pago.payment_method?.redirect_url : undefined);
      if (!direccion || (seguridad?.type && seguridad.type !== "challenge") ||
          (seguridad?.status && !["pending", "waiting_challenge"].includes(seguridad.status))) continue;
      try {
        const url = new URL(direccion);
        if (url.protocol === "https:" && !url.username && !url.password && url.href.length <= 4096) {
          return { url: url.href };
        }
      } catch { /* Una URL inválida no se expone al navegador. */ }
    }
    return null;
  }

  private async conciliar(id: string, cancelar = false) {
    return this.conEventos(
      async (tx, emitir) => {
        // Consulta a MP dentro del bloqueo: dos respuestas concurrentes no pueden
        // aplicar estados leídos en orden inverso ni crear dos pedidos.
        await tx.$queryRaw`SELECT id FROM intentos_compra WHERE id = ${id} FOR UPDATE`;
        const intento = await tx.intentoCompra.findUniqueOrThrow({
          where: { id },
          include: incluirIntento,
        });
        const pago = intento.pago;
        if (!pago?.idOrdenExterna) {
          const rechazado = intento.operaciones[0]?.estado === "FINALIZADA";
          if (intento.modalidad === "ORDERS_API" && (!intento.operaciones.length || rechazado)) {
            if (!rechazado && !cancelar && intento.expiraEn > new Date()) return { resultado: "SIN_COBRO", autenticacion: null };
            // No se inició ninguna llamada de cobro. Es seguro liberar la reserva.
            for (const d of intento.detalles) {
              if (!intento.reservaActiva) break;
              await tx.producto.update({ where: { id: d.productoId }, data: { stock: { increment: d.cantidad } } });
              await tx.movimientoInventario.create({ data: {
                productoId: d.productoId, usuarioId: intento.usuarioId,
                tipo: "LIBERACION", cantidad: d.cantidad, motivo: `Reserva sin cobro ${id}`,
              } });
              emitir({ entidad: "INVENTARIO", entidadId: d.productoId, accion: "ACTUALIZADO" });
            }
            await tx.intentoCompra.update({ where: { id }, data: {
              estado: rechazado ? "RECHAZADO" : cancelar ? "CANCELADO" : "EXPIRADO", reservaActiva: false,
            } });
            if (pago) {
              await tx.pago.update({ where: { id: pago.id }, data: { estado: rechazado ? "RECHAZADO" : "CANCELADO" } });
              emitir({ entidad: "PAGO", entidadId: pago.id, accion: "ACTUALIZADO" });
            }
            return { resultado: rechazado ? "RECHAZADO" : cancelar ? "CANCELADO" : "EXPIRADO", autenticacion: null };
          }
          if (intento.modalidad === "ORDERS_API" && !cancelar) {
            // Consultar mientras el POST sigue en curso es esperado. Un timeout
            // conserva su incertidumbre; no crear órdenes ni liberar inventario.
            await tx.intentoCompra.update({ where: { id }, data: { proximaRevision: new Date(Date.now() + 60_000) } });
            return { resultado: "ESPERANDO_ORDEN", autenticacion: null };
          }
          throw new ServiceUnavailableException("Orden todavía no vinculada; no iniciar otro cobro.");
        }
        let orden: RecursoMP = intento.modalidad === "ORDERS_API"
          ? await this.orders.consultarOrden(pago.idOrdenExterna)
          : await this.solicitar(`/v1/orders/${encodeURIComponent(pago.idOrdenExterna)}`);
        this.verificarOrden(orden, intento);
        const acreditado = () =>
          orden.status === "processed" && orden.status_detail === "accredited";
        const terminal = () =>
          ["failed", "cancelled", "canceled", "expired", "refunded"].includes(
            orden.status ?? "",
          );
        if (
          !acreditado() &&
          !terminal() &&
          intento.estado !== "CONFIRMADO" &&
          (cancelar || intento.expiraEn <= new Date())
        ) {
          // Nunca liberar por el reloj local: primero cancelar en MP y volver a leer.
          await this.solicitar(
            `/v1/orders/${encodeURIComponent(pago.idOrdenExterna)}/cancel`,
            "POST",
            {},
            `${id}-cancel`,
          );
          orden = await this.solicitar(
            `/v1/orders/${encodeURIComponent(pago.idOrdenExterna)}`,
          );
          this.verificarOrden(orden, intento);
        }
        if (
          acreditado() &&
          !this.importeValido(orden.total_paid_amount, intento.total)
        ) {
          throw new ServiceUnavailableException(
            "El importe acreditado no coincide con el intento.",
          );
        }
        const estadoProveedor = `${orden.status ?? "unknown"}:${orden.status_detail ?? "unknown"}`;
        if (pago.estadoProveedor !== estadoProveedor) {
          const codigo = (valor: string | undefined) => valor && /^[A-Za-z0-9_.-]{1,100}$/.test(valor) ? valor : undefined;
          this.logger.log(JSON.stringify({
            intentoId: id, ordenId: pago.idOrdenExterna, resultado: "ORDEN_MP_VERIFICADA",
            estado: codigo(orden.status), detalle: codigo(orden.status_detail),
          }));
        }
        if (intento.modalidad === "ORDERS_API") {
          await tx.operacionCobro.updateMany({ where: { intentoId: id }, data: {
            estado: acreditado() || terminal() ? "FINALIZADA" : "VINCULADA",
            estadoProveedor,
          } });
        }
        const claveEvento = createHash("sha256")
          .update(
            JSON.stringify([
              id,
              estadoProveedor,
              orden.total_paid_amount,
              orden.last_updated_date,
            ]),
          )
          .digest("hex");
        await tx.eventoPago.upsert({
          where: { claveEvento },
          update: {},
          create: {
            pagoId: pago.id,
            claveEvento,
            tipo: "ORDEN_VERIFICADA",
            estadoReportado: estadoProveedor,
          },
        });
        if (intento.estado === "CONFIRMADO") {
          // No degrada un pedido por un evento atrasado. Reembolsos se registran,
          // pero no se cancela ni repone inventario sin un flujo de devolución.
          await tx.pago.update({
            where: { id: pago.id },
            data: {
              estadoProveedor,
              ...(orden.status === "refunded"
                ? { estado: "REEMBOLSADO" as const }
                : {}),
            },
          });
          if (
            pago.estadoProveedor !== estadoProveedor ||
            (orden.status === "refunded" && pago.estado !== "REEMBOLSADO")
          )
            emitir({
              entidad: "PAGO",
              entidadId: pago.id,
              accion: "ACTUALIZADO",
            });
          return { resultado: "YA_CONFIRMADO", autenticacion: null };
        }
        if (acreditado()) {
          if (!intento.reservaActiva) {
            // Defensa ante una acreditación tardía después de un estado terminal.
            for (const d of [...intento.detalles].sort(
              (a, b) => a.productoId - b.productoId,
            )) {
              const cambio = await tx.producto.updateMany({
                where: { id: d.productoId, stock: { gte: d.cantidad } },
                data: { stock: { decrement: d.cantidad } },
              });
              if (!cambio.count)
                throw new ServiceUnavailableException(
                  "Pago tardío sin stock: requiere revisión y posible reembolso.",
                );
            }
          }
          const pedido = await tx.pedido.create({
            data: {
              usuarioId: intento.usuarioId,
              nombre: intento.nombre,
              email: intento.email,
              direccion: intento.direccion,
              claveSolicitud: intento.claveSolicitud,
              huellaSolicitud: intento.huellaSolicitud,
              total: intento.total,
              status: "PAGADO",
              metodoPago: "MERCADO_PAGO",
              detalles: {
                create: intento.detalles.map((d) => ({
                  productoId: d.productoId,
                  cantidad: d.cantidad,
                  precioUnitario: d.precioUnitario,
                  nombreProducto: d.nombreProducto,
                })),
              },
            },
          });
          await tx.pago.update({
            where: { id: pago.id },
            data: {
              pedidoId: pedido.id,
              estado: "APROBADO",
              estadoProveedor,
              aprobadoEn: new Date(),
            },
          });
          await tx.intentoCompra.update({
            where: { id },
            data: {
              estado: "CONFIRMADO",
              pedidoId: pedido.id,
              reservaActiva: false,
              ultimoError: null,
            },
          });
          // RESERVA ya descontó stock. Solo una compra tardía lo descuenta aquí.
          await tx.movimientoInventario.createMany({
            data: intento.detalles.map((d) => ({
              productoId: d.productoId,
              usuarioId: intento.usuarioId,
              pedidoId: pedido.id,
              tipo: "PEDIDO",
              cantidad: intento.reservaActiva ? 0 : -d.cantidad,
              motivo: `Confirmación de reserva ${id}; unidades compradas: ${d.cantidad}`,
            })),
          });
          await tx.eventoEstadoPedido.create({
            data: {
              pedidoId: pedido.id,
              actorId: intento.usuarioId,
              hacia: "PAGADO",
              motivo: "Pago acreditado verificado con Mercado Pago",
            },
          });
          emitir({ entidad: "PEDIDO", entidadId: pedido.id, accion: "CREADO" });
          emitir({
            entidad: "PAGO",
            entidadId: pago.id,
            accion: "ACTUALIZADO",
          });
          if (!intento.reservaActiva) {
            for (const d of intento.detalles)
              emitir({
                entidad: "INVENTARIO",
                entidadId: d.productoId,
                accion: "ACTUALIZADO",
              });
          }
          return { resultado: "CONFIRMADO", autenticacion: null };
        }
        if (terminal()) {
          if (intento.reservaActiva) {
            // Orden determinista de productos evita interbloqueos con otros carritos.
            for (const d of [...intento.detalles].sort(
              (a, b) => a.productoId - b.productoId,
            )) {
              await tx.producto.update({
                where: { id: d.productoId },
                data: { stock: { increment: d.cantidad } },
              });
              await tx.movimientoInventario.create({
                data: {
                  productoId: d.productoId,
                  usuarioId: intento.usuarioId,
                  tipo: "LIBERACION",
                  cantidad: d.cantidad,
                  motivo: `Reserva liberada ${id}: ${estadoProveedor}`,
                },
              });
            }
          }
          const estado: EstadoIntento =
            orden.status === "failed"
              ? "RECHAZADO"
              : intento.expiraEn <= new Date() || orden.status === "expired"
                ? "EXPIRADO"
                : "CANCELADO";
          await tx.intentoCompra.update({
            where: { id },
            data: { estado, reservaActiva: false, ultimoError: null },
          });
          await tx.pago.update({
            where: { id: pago.id },
            data: {
              estado:
                orden.status === "refunded"
                  ? "REEMBOLSADO"
                  : estado === "RECHAZADO"
                    ? "RECHAZADO"
                    : "CANCELADO",
              estadoProveedor,
            },
          });
          const estadoPago =
            orden.status === "refunded"
              ? "REEMBOLSADO"
              : estado === "RECHAZADO"
                ? "RECHAZADO"
                : "CANCELADO";
          if (
            pago.estado !== estadoPago ||
            pago.estadoProveedor !== estadoProveedor
          )
            emitir({
              entidad: "PAGO",
              entidadId: pago.id,
              accion: "ACTUALIZADO",
            });
          if (intento.reservaActiva) {
            for (const d of intento.detalles)
              emitir({
                entidad: "INVENTARIO",
                entidadId: d.productoId,
                accion: "ACTUALIZADO",
              });
          }
          return { resultado: estado, autenticacion: null };
        }
        await tx.pago.update({
          where: { id: pago.id },
          data: { estadoProveedor },
        });
        await tx.intentoCompra.update({
          where: { id },
          data: {
            estado: "EN_PROCESO",
            ultimoError: null,
            proximaRevision: new Date(Date.now() + 60_000),
          },
        });
        if (pago.estadoProveedor !== estadoProveedor)
          emitir({
            entidad: "PAGO",
            entidadId: pago.id,
            accion: "ACTUALIZADO",
          });
        return { resultado: "EN_PROCESO", autenticacion: this.autenticacionOrden(orden) };
      },
      { maxWait: 10000, timeout: 45000 },
    );
  }

  private async conciliarLegacy(ordenId: string) {
    return this.conEventos(
      async (tx, emitir) => {
        await tx.$queryRaw`SELECT id FROM pagos WHERE id_orden_externa = ${ordenId} FOR UPDATE`;
        const pago = await tx.pago.findUniqueOrThrow({
          where: { idOrdenExterna: ordenId },
          include: { pedido: true },
        });
        const orden = await this.solicitar(
          `/v1/orders/${encodeURIComponent(ordenId)}`,
        );
        if (
          String(orden.id) !== ordenId ||
          String(orden.user_id) !== this.configuracion().collector ||
          orden.external_reference !== `TL-PAGO-${pago.id}` ||
          orden.currency !== pago.moneda ||
          !this.importeValido(orden.total_amount, pago.monto) ||
          !pago.pedido?.total.equals(pago.monto)
        ) {
          throw new ServiceUnavailableException(
            "Orden anterior no coincide con el pago local.",
          );
        }
        if (
          orden.status === "processed" &&
          orden.status_detail === "accredited"
        ) {
          if (!this.importeValido(orden.total_paid_amount, pago.monto))
            throw new ServiceUnavailableException(
              "Importe acreditado inválido.",
            );
          if (pago.estado === "PENDIENTE") {
            await tx.pago.update({
              where: { id: pago.id },
              data: {
                estado: "APROBADO",
                aprobadoEn: new Date(),
                estadoProveedor: "processed:accredited",
              },
            });
            const cambioPedido = await tx.pedido.updateMany({
              where: { id: pago.pedidoId!, status: "PENDIENTE" },
              data: { status: "PAGADO" },
            });
            emitir({
              entidad: "PAGO",
              entidadId: pago.id,
              accion: "ACTUALIZADO",
            });
            if (cambioPedido.count)
              emitir({
                entidad: "PEDIDO",
                entidadId: pago.pedidoId!,
                accion: "ACTUALIZADO",
              });
          }
          return { resultado: "LEGACY_VERIFICADO" };
        }
        await tx.pago.update({
          where: { id: pago.id },
          data: { estadoProveedor: `${orden.status}:${orden.status_detail}` },
        });
        if (pago.estadoProveedor !== `${orden.status}:${orden.status_detail}`)
          emitir({
            entidad: "PAGO",
            entidadId: pago.id,
            accion: "ACTUALIZADO",
          });
        return { resultado: "LEGACY_EN_PROCESO" };
      },
      { timeout: 25000 },
    );
  }

  private async registrarFallo(id: string, error: unknown) {
    const motivo =
      error instanceof ServiceUnavailableException
        ? error.message
        : "Error interno al verificar el pago.";
    await this.db.intentoCompra.updateMany({
      where: { id, estado: { in: pendientes } },
      data: {
        estado: "EN_PROCESO",
        ultimoError: motivo,
        proximaRevision: new Date(Date.now() + 60_000),
      },
    });
    this.logger.error(
      JSON.stringify({
        intentoId: id,
        resultado: "REINTENTAR_VERIFICACION",
        motivo,
      }),
    );
  }

  async revisarPendientes() {
    if (
      this.revisando ||
      !process.env.MP_ACCESS_TOKEN ||
      !process.env.MP_COLLECTOR_ID
    )
      return;
    this.revisando = true;
    try {
      const intentos = await this.db.intentoCompra.findMany({
        where: {
          estado: { in: pendientes },
          proximaRevision: { lte: new Date() },
        },
        orderBy: { proximaRevision: "asc" },
        take: 20,
      });
      for (const intento of intentos) {
        try {
          await this.prepararOrden(intento.id);
          await this.conciliar(intento.id);
        } catch (error) {
          await this.registrarFallo(intento.id, error);
        }
      }
    } catch {
      this.logger.error("No se pudo ejecutar la conciliación de pagos.");
    } finally {
      this.revisando = false;
    }
  }

  private async solicitar(
    ruta: string,
    method = "GET",
    datos?: unknown,
    clave?: string,
  ): Promise<RecursoMP> {
    const { token } = this.configuracion();
    let respuesta: Response;
    try {
      respuesta = await fetch(`https://api.mercadopago.com${ruta}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...(clave ? { "X-Idempotency-Key": clave } : {}),
        },
        ...(datos !== undefined ? { body: JSON.stringify(datos) } : {}),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new ServiceUnavailableException(
        "No hubo respuesta de Mercado Pago. Reintenta el mismo intento.",
      );
    }
    if (!respuesta.ok) {
      // No imprimir cuerpos del proveedor: pueden incluir datos del comprador.
      this.logger.error(
        JSON.stringify({
          ruta,
          http: respuesta.status,
          resultado: "ERROR_PROVEEDOR",
        }),
      );
      throw new ServiceUnavailableException(
        `Mercado Pago respondió HTTP ${respuesta.status}; verifica la configuración y el estado del intento.`,
      );
    }
    try {
      return (await respuesta.json()) as RecursoMP;
    } catch {
      throw new ServiceUnavailableException(
        "Mercado Pago devolvió JSON inválido.",
      );
    }
  }
}
