//Este archivo tiene por objetivo centralizar las llamas a Mercado Pago
import {
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";

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
    public readonly diagnostico: { codigo?: string; causas?: string[]; requestId?: string } = {},
  ) {
    super(
      httpProveedor === null
        ? "No se pudo confirmar la respuesta de Mercado Pago."
        : `Mercado Pago respondió HTTP ${httpProveedor}${diagnostico.codigo ? ` (${diagnostico.codigo})` : ""}.`,
    );
    // Un timeout, conflicto de idempotencia, 429, 5xx o respuesta incompleta
    // nunca demuestra ausencia de cobro.
    this.rechazadoDefinitivo = httpProveedor !== null &&
      [400, 401, 403, 404, 405, 422].includes(httpProveedor);
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
              ...(datos.modoCaptura === "automatic_async" ? {
                transaction_security: { validation: "on_fraud_risk" },
              } : {}),
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
      const codigo = (v: unknown) => typeof v === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(v)
        ? v : typeof v === "number" && Number.isSafeInteger(v) ? String(v) : undefined;
      const datos = cuerpo && typeof cuerpo === "object" ? cuerpo as Record<string, unknown> : {};
      const causas = Array.isArray(datos.cause) ? datos.cause.slice(0, 10).flatMap((c: unknown) => {
        const valor = c && typeof c === "object" && "code" in c ? codigo(c.code) : undefined;
        return valor ? [valor] : [];
      }) : [];
      throw new ErrorOrdersMP(respuesta.status, {
        codigo: codigo(datos.error) ?? codigo(datos.code),
        causas,
        requestId: codigo(respuesta.headers.get("x-request-id")),
      });
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
      transactions: this.extraerAutenticacion(orden.transactions),
    };
  }

  private extraerAutenticacion(valor: unknown): OrdenMP["transactions"] {
    if (!valor || typeof valor !== "object" || !("payments" in valor) || !Array.isArray(valor.payments)) return;
    return { payments: valor.payments.map((p: unknown) => {
      if (!p || typeof p !== "object" || !("payment_method" in p)) return {};
      const metodo = p.payment_method;
      if (!metodo || typeof metodo !== "object") return {};
      const seguridad = "transaction_security" in metodo ? metodo.transaction_security : null;
      return { payment_method: {
        redirect_url: "redirect_url" in metodo && typeof metodo.redirect_url === "string" ? metodo.redirect_url : undefined,
        transaction_security: seguridad && typeof seguridad === "object" ? {
        url: "url" in seguridad && typeof seguridad.url === "string" ? seguridad.url : undefined,
        type: "type" in seguridad && typeof seguridad.type === "string" ? seguridad.type : undefined,
        status: "status" in seguridad && typeof seguridad.status === "string" ? seguridad.status : undefined,
      } : undefined } };
    }) };
  }
}
