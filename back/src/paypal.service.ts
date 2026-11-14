import { Injectable, ServiceUnavailableException } from "@nestjs/common";

export type DatosOrdenPayPal = {
  entorno: "sandbox" | "live";
  body: {
    intent: "CAPTURE";
    purchase_units: Array<{
      reference_id: string;
      custom_id: string;
      payee: { merchant_id: string };
      amount: {
        currency_code: string;
        value: string;
        breakdown: { item_total: { currency_code: string; value: string } };
      };
      items: Array<{
        name: string;
        quantity: string;
        unit_amount: { currency_code: string; value: string };
      }>;
    }>;
    payment_source: {
      paypal: {
        experience_context: {
          user_action: "PAY_NOW";
          shipping_preference: "NO_SHIPPING";
          return_url: string;
          cancel_url: string;
        };
      };
    };
  };
};

type OrdenPayPal = {
  id: string;
  status: string;
  links?: Array<{ href: string; rel: string }>;
  purchase_units?: Array<{
    custom_id?: string;
    payee?: { merchant_id?: string };
    amount?: { currency_code?: string; value?: string };
    payments?: {
      captures?: Array<{
        id?: string;
        status?: string;
        amount?: { currency_code?: string; value?: string };
      }>;
    };
  }>;
};

export class ErrorPayPal extends ServiceUnavailableException {
  constructor(
    public readonly http: number | null,
    public readonly codigo?: string,
  ) {
    super(
      "No pudimos obtener la confirmación de PayPal. Consulta tu compra antes de volver a pagar.",
    );
  }
  get rechazoCreacion() {
    return this.http !== null && [400, 401, 403, 404, 422].includes(this.http);
  }
}

@Injectable()
export class PayPalService {
  private acceso?: { token: string; vence: number; credenciales: string };

  entorno(): "sandbox" | "live" {
    const valor = process.env.PAYPAL_ENV?.trim() || "sandbox";
    if (valor !== "sandbox" && valor !== "live")
      throw new ServiceUnavailableException("PAYPAL_ENV no es válido.");
    return valor;
  }
  merchantId() {
    const valor = process.env.PAYPAL_MERCHANT_ID?.trim();
    if (!valor || !/^[A-Za-z0-9]{8,30}$/.test(valor))
      throw new ServiceUnavailableException(
        "Falta PAYPAL_MERCHANT_ID en el backend.",
      );
    return valor;
  }
  configuracion() {
    if (
      !process.env.PAYPAL_CLIENT_ID?.trim() ||
      !process.env.PAYPAL_CLIENT_SECRET?.trim()
    ) {
      throw new ServiceUnavailableException(
        "Configura PAYPAL_CLIENT_ID y PAYPAL_CLIENT_SECRET en el backend.",
      );
    }
    this.merchantId();
    this.entorno();
    this.retorno();
  }
  private retorno() {
    const valor =
      process.env.PAYPAL_RETURN_BASE_URL?.trim() ||
      process.env.PUBLIC_SITE_URL?.trim();
    let url: URL;
    try {
      url = new URL(valor || "");
    } catch {
      throw new ServiceUnavailableException(
        "Configura PAYPAL_RETURN_BASE_URL con la URL del frontend.",
      );
    }
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== "https:" &&
        !(
          this.entorno() === "sandbox" &&
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(url.hostname)
        ))
    ) {
      throw new ServiceUnavailableException(
        "La URL de retorno de PayPal no es válida.",
      );
    }
    return url.href.replace(/\/$/, "");
  }
  preparar(
    id: string,
    total: string,
    detalles: Array<{
      nombreProducto: string;
      cantidad: number;
      precioUnitario: { toFixed(n: number): string };
    }>,
  ): DatosOrdenPayPal {
    this.configuracion();
    const retorno = `${this.retorno()}/pago/paypal?intento=${encodeURIComponent(id)}`;
    return {
      entorno: this.entorno(),
      body: {
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: id,
            custom_id: `TL-INTENTO-${id}`,
            payee: { merchant_id: this.merchantId() },
            amount: {
              currency_code: "MXN",
              value: total,
              breakdown: { item_total: { currency_code: "MXN", value: total } },
            },
            items: detalles.map((d) => ({
              name: d.nombreProducto.slice(0, 127),
              quantity: String(d.cantidad),
              unit_amount: {
                currency_code: "MXN",
                value: d.precioUnitario.toFixed(2),
              },
            })),
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              user_action: "PAY_NOW",
              shipping_preference: "NO_SHIPPING",
              return_url: `${retorno}&resultado=aprobado`,
              cancel_url: `${retorno}&resultado=cancelado`,
            },
          },
        },
      },
    };
  }
  private base() {
    return this.entorno() === "sandbox"
      ? "https://api-m.sandbox.paypal.com"
      : "https://api-m.paypal.com";
  }
  private async token() {
    const id = process.env.PAYPAL_CLIENT_ID?.trim(),
      secreto = process.env.PAYPAL_CLIENT_SECRET?.trim();
    if (!id || !secreto)
      throw new ServiceUnavailableException(
        "Configura las credenciales de PayPal en el backend.",
      );
    const credenciales = `${this.entorno()}:${id}:${secreto}`;
    if (
      this.acceso &&
      this.acceso.credenciales === credenciales &&
      this.acceso.vence > Date.now()
    )
      return this.acceso.token;
    let response: Response;
    try {
      response = await fetch(`${this.base()}/v1/oauth2/token`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${id}:${secreto}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ErrorPayPal(null);
    }
    const body = await response.json().catch(() => null);
    if (
      !response.ok ||
      typeof body?.access_token !== "string" ||
      typeof body?.expires_in !== "number"
    )
      throw new ErrorPayPal(response.status);
    this.acceso = {
      token: body.access_token,
      vence: Date.now() + Math.max(0, body.expires_in - 60) * 1000,
      credenciales,
    };
    return this.acceso.token;
  }
  private async solicitar(
    ruta: string,
    metodo: "GET" | "POST",
    clave?: string,
    body?: unknown,
  ): Promise<OrdenPayPal> {
    const token = await this.token();
    let response: Response;
    try {
      response = await fetch(`${this.base()}${ruta}`, {
        method: metodo,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
          ...(clave ? { "PayPal-Request-Id": clave } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new ErrorPayPal(null);
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const motivo = data?.details?.[0]?.issue;
      throw new ErrorPayPal(
        response.status,
        typeof motivo === "string" && /^[A-Z0-9_]{1,80}$/.test(motivo)
          ? motivo
          : undefined,
      );
    }
    if (
      !data ||
      typeof data.id !== "string" ||
      !/^[A-Za-z0-9]{1,64}$/.test(data.id) ||
      typeof data.status !== "string"
    )
      throw new ErrorPayPal(response.status);
    return data as OrdenPayPal;
  }
  async crear(datos: DatosOrdenPayPal, clave: string) {
    // El payload y el entorno quedan fijados antes de la primera petición.
    if (
      datos.entorno !== this.entorno() ||
      datos.body.purchase_units[0]?.payee.merchant_id !== this.merchantId()
    ) {
      throw new ServiceUnavailableException(
        "La configuración de PayPal cambió. Revisa la compra pendiente.",
      );
    }
    const creada = await this.solicitar(
      "/v2/checkout/orders",
      "POST",
      clave,
      datos.body,
    );
    return this.consultar(creada.id);
  }
  consultar(id: string) {
    return this.solicitar(
      `/v2/checkout/orders/${encodeURIComponent(id)}`,
      "GET",
    );
  }
  capturar(id: string, clave: string) {
    return this.solicitar(
      `/v2/checkout/orders/${encodeURIComponent(id)}/capture`,
      "POST",
      clave,
      {},
    );
  }
  urlAprobacion(orden: OrdenPayPal): string | null {
    const link = orden.links?.find(
      (l) => l.rel === "payer-action" || l.rel === "approve",
    );
    if (!link) return null;
    const url = new URL(link.href);
    const host =
      this.entorno() === "sandbox"
        ? "www.sandbox.paypal.com"
        : "www.paypal.com";
    if (
      url.protocol !== "https:" ||
      url.hostname !== host ||
      url.username ||
      url.password ||
      url.port ||
      url.searchParams.get("token") !== orden.id
    )
      throw new ErrorPayPal(null, "INVALID_APPROVAL_URL");
    return url.href;
  }
  normalizar(orden: OrdenPayPal) {
    if (orden.purchase_units?.length !== 1)
      throw new ErrorPayPal(null, "INVALID_PURCHASE_UNITS");
    const unidad = orden.purchase_units[0];
    const capturas = unidad.payments?.captures ?? [];
    if (capturas.length > 1) throw new ErrorPayPal(null, "UNEXPECTED_CAPTURES");
    const captura = capturas[0];
    if (
      captura &&
      captura.amount?.currency_code !== unidad.amount?.currency_code
    )
      throw new ErrorPayPal(null, "INVALID_CAPTURE_CURRENCY");
    const pagado =
      orden.status === "COMPLETED" && captura?.status === "COMPLETED";
    if (pagado && (!captura?.id || !/^[A-Za-z0-9]{1,64}$/.test(captura.id)))
      throw new ErrorPayPal(null, "INVALID_CAPTURE_ID");
    const rechazado = ["DENIED", "DECLINED", "FAILED"].includes(
      captura?.status ?? "",
    );
    return {
      id: orden.id,
      status: pagado
        ? "processed"
        : rechazado
          ? "failed"
          : orden.status === "VOIDED"
            ? "cancelled"
            : "processing",
      status_detail: pagado
        ? "accredited"
        : rechazado
          ? "rejected_by_bank"
          : captura?.status === "PENDING"
            ? "capture_pending"
            : orden.status.toLowerCase(),
      total_amount: unidad.amount?.value,
      total_paid_amount: pagado ? captura?.amount?.value : "0.00",
      currency: unidad.amount?.currency_code,
      external_reference: unidad.custom_id,
      user_id: unidad.payee?.merchant_id,
      capture_id: captura?.id,
    };
  }
}
