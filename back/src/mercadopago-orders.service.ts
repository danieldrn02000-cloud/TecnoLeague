//Este archivo tiene por objetivo centralizar las llamas a Mercado Pago
import {
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { esMotivoTarjeta } from "./mensajes-pago";

export type CrearOrdenInput = {
  modoCaptura?: "automatic" | "automatic_async";
  // Siempre calculado por el backend, nunca tomado del frontend.
  total: string;
  referenciaExterna: string;

  // Generada y guardada por el backend antes de llamar a Mercado Pago.
  claveIdempotencia: string;

  email: string;
  token: string;
  metodoPagoId: string;
  tipoMetodoPago: "credit_card" | "debit_card";
  cuotas: number;

  identificacion?: {
    tipo: string;
    numero: string;
  };
};

export type OrdenMP = {
  id: string;
  status: string;
  status_detail?: string;
  external_reference?: string;
  total_amount?: string;
  total_paid_amount?: string;
  currency?: string;
  country_code?: string;
  last_updated_date?: string;
  user_id?: string | number;

  transactions?: {
    payments?: Array<{
      id?: string;
      status?: string;
      status_detail?: string;
      amount?: string;
      paid_amount?: string;
      payment_method?: {
        redirect_url?: string;
        transaction_security?: { url?: string; type?: string; status?: string };
      };
    }>;
  };
};

// El servicio de negocio debe conservar la operación y consultar su
// resultado ante este error; nunca asumir que no hubo cobro.
export class ErrorOrdersMP extends ServiceUnavailableException {
  readonly rechazadoDefinitivo: boolean;
  constructor(
    public readonly httpProveedor: number | null,
    public readonly diagnostico: { codigo?: string; causas?: string[]; campos?: string[]; formato?: string; requestId?: string; motivoTarjeta?: string } = {},
  ) {
    super(
      httpProveedor === null
        ? "No se pudo confirmar la respuesta de Mercado Pago."
        : `Mercado Pago respondió HTTP ${httpProveedor}${diagnostico.codigo ? ` (${diagnostico.codigo})` : ""}.`,
    );
    // Un timeout, conflicto de idempotencia, 429, 5xx o respuesta incompleta
    // nunca demuestra ausencia de cobro.
    this.rechazadoDefinitivo = httpProveedor !== null &&
      ([400, 401, 403, 404, 405, 422].includes(httpProveedor) ||
        // Orders devuelve 402 + failed al rechazar la transacción del POST.
        // Otros 402 sin ese código se conservan como inciertos.
        (httpProveedor === 402 && (diagnostico.codigo === "failed" || esMotivoTarjeta(diagnostico.codigo))));
  }
}

@Injectable()
export class MercadoPagoOrdersService {
  private obtenerToken(): string {
    const token = process.env.MP_ACCESS_TOKEN?.trim();

    if (!token) {
      throw new ServiceUnavailableException(
        "Falta MP_ACCESS_TOKEN en el backend.",
      );
    }

    return token;
  }

  async crearYProcesarOrden(
    datos: CrearOrdenInput,
  ): Promise<OrdenMP> {
    if (
      !/^\d+\.\d{2}$/.test(datos.total) ||
      Number(datos.total) <= 0 ||
      !datos.referenciaExterna ||
      !datos.claveIdempotencia ||
      !datos.token ||
      !datos.metodoPagoId ||
      !Number.isInteger(datos.cuotas) ||
      datos.cuotas < 1
    ) {
      throw new ServiceUnavailableException(
        "Los datos internos de la operación de pago no son válidos.",
      );
    }

    const payload = {
      type: "online",
      processing_mode: "automatic",
      capture_mode: datos.modoCaptura ?? "automatic",
      currency: "MXN",
      total_amount: datos.total,
      external_reference: datos.referenciaExterna,
      ...(datos.modoCaptura === "automatic_async" ? {
        config: { online: { transaction_security: {
          validation: "on_fraud_risk", liability_shift: "required",
        } } },
      } : {}),

      payer: {
        email: datos.email,
        ...(datos.identificacion
          ? {
              identification: {
                type: datos.identificacion.tipo,
                number: datos.identificacion.numero,
              },
            }
          : {}),
      },

      transactions: {
        payments: [
          {
            amount: datos.total,
            payment_method: {
              id: datos.metodoPagoId,
              type: datos.tipoMetodoPago,
              token: datos.token,
              installments: datos.cuotas,
            },
          },
        ],
      },
    };

    return this.solicitar(
      "/v1/orders",
      "POST",
      payload,
      datos.claveIdempotencia,
    );
  }

  async consultarOrden(ordenId: string): Promise<OrdenMP> {
    if (!ordenId.trim()) {
      throw new ServiceUnavailableException(
        "Falta el identificador de la orden.",
      );
    }

    return this.solicitar(
      `/v1/orders/${encodeURIComponent(ordenId)}`,
      "GET",
    );
  }

  private async solicitar(
    ruta: string,
    metodo: "GET" | "POST",
    payload?: unknown,
    claveIdempotencia?: string,
  ): Promise<OrdenMP> {
    const token = this.obtenerToken();

    let respuesta: Response;

    try {
      respuesta = await fetch(
        `https://api.mercadopago.com${ruta}`,
        {
          method: metodo,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            ...(claveIdempotencia
              ? { "X-Idempotency-Key": claveIdempotencia }
              : {}),
          },
          ...(payload !== undefined
            ? { body: JSON.stringify(payload) }
            : {}),
          signal: AbortSignal.timeout(15_000),
        },
      );
    } catch (error) {
      // Incluye timeout: la orden podría haberse creado.
      let codigo = "ERROR_RED";
      if (error && typeof error === "object") {
        if ("name" in error && error.name === "TimeoutError") codigo = "TIMEOUT";
        const causa = "cause" in error ? error.cause : null;
        const candidato = causa && typeof causa === "object" && "code" in causa ? causa.code : null;
        if (typeof candidato === "string" && ["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UND_ERR_CONNECT_TIMEOUT"].includes(candidato)) codigo = candidato;
      }
      throw new ErrorOrdersMP(null, { codigo });
    }

    if (!respuesta.ok) {
      // Extraer solo códigos y el ID de soporte; nunca mensajes ni cuerpos.
      const cuerpo: unknown = await respuesta.json().catch(() => null);
      throw new ErrorOrdersMP(respuesta.status,
        this.diagnosticoError(cuerpo, respuesta.headers.get("x-request-id")));
    }

    let resultado: unknown;

    try {
      resultado = await respuesta.json();
    } catch {
      // Una respuesta ilegible tampoco demuestra que el cobro falló.
      throw new ErrorOrdersMP(respuesta.status);
    }

    if (
      !resultado ||
      typeof resultado !== "object" ||
      !("id" in resultado) ||
      typeof resultado.id !== "string" ||
      !resultado.id ||
      !("status" in resultado) ||
      typeof resultado.status !== "string"
    ) {
      throw new ErrorOrdersMP(respuesta.status);
    }

    const orden = resultado as Record<string, unknown>;
    // No propagar tokens ni otros datos personales devueltos por el proveedor.
    return {
      id: resultado.id,
      status: resultado.status,
      status_detail: typeof orden.status_detail === "string" ? orden.status_detail : undefined,
      external_reference: typeof orden.external_reference === "string" ? orden.external_reference : undefined,
      total_amount: typeof orden.total_amount === "string" ? orden.total_amount : undefined,
      total_paid_amount: typeof orden.total_paid_amount === "string" ? orden.total_paid_amount : undefined,
      currency: typeof orden.currency === "string" ? orden.currency : undefined,
      country_code: typeof orden.country_code === "string" ? orden.country_code : undefined,
      user_id: typeof orden.user_id === "string" || typeof orden.user_id === "number" ? orden.user_id : undefined,
      last_updated_date: typeof orden.last_updated_date === "string" ? orden.last_updated_date : undefined,
      transactions: this.extraerTransacciones(orden.transactions),
    };
  }

  private diagnosticoError(cuerpo: unknown, requestId: string | null): ErrorOrdersMP["diagnostico"] {
    const codigo = (v: unknown) => typeof v === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(v)
      ? v : typeof v === "number" && Number.isSafeInteger(v) ? String(v) : undefined;
    const datos: Record<string, unknown> = Array.isArray(cuerpo) ? { errors: cuerpo }
      : cuerpo && typeof cuerpo === "object" ? cuerpo as Record<string, unknown> : {};
    // Solo nombres conocidos del contrato: nunca imprimir valores ni mensajes.
    const camposPermitidos = new Set([
      "type", "processing_mode", "capture_mode", "currency", "total_amount", "external_reference",
      "config", "config.online", "config.online.transaction_security", "config.online.transaction_security.validation",
      "config.online.transaction_security.liability_shift",
      "payer", "payer.email", "payer.identification", "payer.identification.type", "payer.identification.number",
      "transactions", "transactions.payments", "transactions.payments[0].amount",
      "transactions.payments[0].payment_method", "transactions.payments[0].payment_method.id",
      "transactions.payments[0].payment_method.type", "transactions.payments[0].payment_method.token",
      "transactions.payments[0].payment_method.installments",
      "transactions.payments[0].payment_method.transaction_security",
      "transactions.payments[0].payment_method.transaction_security.validation",
    ]);
    const campos = new Set<string>();
    const registros: Record<string, unknown>[] = [];
    let motivoTarjeta: string | undefined;
    const motivo = (valor: unknown) => {
      if (!motivoTarjeta && esMotivoTarjeta(valor)) motivoTarjeta = valor;
    };
    const campo = (valor: unknown) => {
      if (typeof valor !== "string" || valor.length > 2048) return;
      const normalizado = valor.replace(/^\//, "").replace(/\/(\d+)(?=\/|$)/g, "[$1]").replace(/\//g, ".");
      if (camposPermitidos.has(normalizado)) { campos.add(normalizado); return; }
      // Algunos formatos nombran el campo dentro de una descripción. Extraer
      // únicamente nombres públicos conocidos, nunca guardar la descripción.
      for (const nombre of valor.match(/[A-Za-z_][A-Za-z0-9_]*(?:(?:\.[A-Za-z_][A-Za-z0-9_]*)|(?:\[\d+\]))*/g) ?? []) {
        if (camposPermitidos.has(nombre)) campos.add(nombre);
      }
    };
    const recoger = (valor: unknown, nivel = 0) => {
      if (nivel > 4 || registros.length >= 30) return;
      if (Array.isArray(valor)) { valor.slice(0, 10).forEach(v => recoger(v, nivel + 1)); return; }
      if (!valor || typeof valor !== "object") { campo(valor); motivo(valor); return; }
      const registro = valor as Record<string, unknown>;
      registros.push(registro);
      for (const nombre of ["code", "error", "status_detail", "cause"]) motivo(registro[nombre]);
      for (const nombre of ["field", "path", "property", "parameter", "message", "description"]) campo(registro[nombre]);
      for (const nombre of ["errors", "cause", "causes", "error", "details", "transactions", "payments", "data"]) recoger(registro[nombre], nivel + 1);
    };
    recoger(datos);
    const causas = [...new Set(registros.slice(1).flatMap(r => {
      const valor = codigo(r.code) ?? codigo(r.error);
      return valor ? [valor] : [];
    }))].slice(0, 10);
    return {
      codigo: codigo(datos.error) ?? codigo(datos.code) ?? causas[0],
      causas,
      campos: [...campos],
      formato: Array.isArray(datos.errors) ? "errors" : Array.isArray(datos.cause) ? "cause"
        : Array.isArray(datos.causes) ? "causes" : cuerpo && typeof cuerpo === "object" ? "json" : "no_json",
      requestId: codigo(requestId),
      ...(motivoTarjeta ? { motivoTarjeta } : {}),
    };
  }

  private extraerTransacciones(valor: unknown): OrdenMP["transactions"] {
    if (!valor || typeof valor !== "object" || !("payments" in valor) || !Array.isArray(valor.payments)) return;
    return { payments: valor.payments.map((p: unknown) => {
      if (!p || typeof p !== "object") return {};
      const codigo = (v: unknown) => typeof v === "string" && /^[A-Za-z0-9_.-]{1,100}$/.test(v) ? v : undefined;
      const estado = {
        status: codigo("status" in p ? p.status : undefined),
        status_detail: codigo("status_detail" in p ? p.status_detail : undefined),
      };
      const metodo = "payment_method" in p ? p.payment_method : null;
      if (!metodo || typeof metodo !== "object") return estado;
      const seguridad = "transaction_security" in metodo ? metodo.transaction_security : null;
      return { ...estado, payment_method: {
        redirect_url: "redirect_url" in metodo && typeof metodo.redirect_url === "string" ? metodo.redirect_url : undefined,
        transaction_security: seguridad && typeof seguridad === "object" ? {
        url: "url" in seguridad && typeof seguridad.url === "string" ? seguridad.url : undefined,
        type: "type" in seguridad && typeof seguridad.type === "string" ? seguridad.type : undefined,
        status: "status" in seguridad && typeof seguridad.status === "string" ? seguridad.status : undefined,
      } : undefined } };
    }) };
  }
}
