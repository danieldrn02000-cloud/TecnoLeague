// Campos seguros del SDK oficial: la tarjeta completa nunca pasa por React.
export type TarjetaTokenizada = {
  token: string;
  paymentMethodId: string;
  paymentTypeId: "credit_card" | "debit_card";
  installments: string;
};
export type CampoSeguro = {
  mount(contenedor: string): CampoSeguro;
  unmount(): void;
  on(evento: string, callback: (datos: { bin?: string | null }) => void): void;
  update(propiedades: { settings: { length?: number; validation?: string; mode?: string } }): void;
};
export type MetodoTarjeta = {
  id: string;
  name: string;
  payment_type_id: string;
  settings?: { card_number?: { length: number; validation: string }; security_code?: { length: number; mode: string } }[];
};
export type PlanCuotas = {
  payment_method_id?: string;
  issuer?: { id: string | number };
  payer_costs: { installments: number; recommended_message: string }[];
};
export type InstanciaMercadoPago = {
  fields: {
    create(tipo: "cardNumber" | "expirationDate" | "securityCode", opciones: { placeholder: string }): CampoSeguro;
    createCardToken(datos: { cardholderName: string }): Promise<{ id: string } | undefined>;
  };
  getPaymentMethods(datos: { bin: string }): Promise<{ results: MetodoTarjeta[] }>;
  getIssuers(datos: { paymentMethodId: string; bin: string }): Promise<{ id: string | number; name: string }[]>;
  getInstallments(datos: { amount: string; bin: string }): Promise<PlanCuotas[]>;
};

type ConstructorMercadoPago = new (
  publicKey: string,
  opciones: { locale: string },
) => InstanciaMercadoPago;

declare global {
  interface Window {
    MercadoPago?: ConstructorMercadoPago;
  }
}

let carga: Promise<ConstructorMercadoPago> | undefined;

function cargarSDK(): Promise<ConstructorMercadoPago> {
  if (window.MercadoPago) {
    return Promise.resolve(window.MercadoPago);
  }

  if (!carga) {
    carga = new Promise<ConstructorMercadoPago>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://sdk.mercadopago.com/js/v2";
      script.async = true;

      script.onload = () => {
        if (window.MercadoPago) {
          resolve(window.MercadoPago);
        } else {
          script.remove();
          reject(new Error("Mercado Pago no pudo inicializarse."));
        }
      };

      script.onerror = () => {
        script.remove();
        reject(new Error("No se pudo cargar Mercado Pago."));
      };

      document.head.appendChild(script);
    }).catch((error: unknown) => {
      carga = undefined;
      throw error;
    });
  }

  return carga;
}

export async function obtenerMercadoPago(): Promise<InstanciaMercadoPago> {
  const publicKey = import.meta.env.PUBLIC_MP_PUBLIC_KEY?.trim();

  if (!publicKey) {
    throw new Error("Falta PUBLIC_MP_PUBLIC_KEY en front/.env.");
  }

  const MercadoPago = await cargarSDK();

  return new MercadoPago(publicKey, { locale: "es-MX" });
}
