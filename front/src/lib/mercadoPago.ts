//Este archivo carga una sola vez MercadoPago.njs desde la url del sdk
//Lo inicializa con la public key
export type DatosTarjeta = {
  token: string;
  paymentMethodId: string;
  issuerId: string;
  installments: string;
  cardholderEmail: string;
  identificationType: string;
  identificationNumber: string;
};
export type TarjetaTokenizada = DatosTarjeta & {
  paymentTypeId: "credit_card" | "debit_card";
};

type Campo = {
  id: string;
  placeholder?: string;
};

type ConfiguracionCardForm = {
  amount: string;
  iframe: boolean;
  form: {
    id: string;
    cardNumber: Campo;
    expirationDate: Campo;
    securityCode: Campo;
    cardholderName: Campo;
    issuer: Campo;
    installments: Campo;
    identificationType: Campo;
    identificationNumber: Campo;
    cardholderEmail: Campo;
  };
  callbacks: {
    onFormMounted: (error?: unknown) => void;
    onSubmit: (event: Event) => void;
    onPaymentMethodsReceived?: (error?: unknown, data?: {
      results: { id: string; payment_type_id: string }[];
    }) => void;
    onBinChange?: () => void;
    onError?: (error?: unknown) => void;
  };
};

export type InstanciaCardForm = {
  getCardFormData(): DatosTarjeta;
  unmount(): void;
};

type InstanciaMercadoPago = {
  cardForm(config: ConfiguracionCardForm): InstanciaCardForm;
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
