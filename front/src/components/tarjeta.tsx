//Aqui se monta el formulario con CardForm e inputs iFrame del SDK
import { useEffect, useId, useRef, useState } from "react";
import {
  obtenerMercadoPago,
  type DatosTarjeta,
  type InstanciaCardForm,
} from "../lib/mercadoPago";

type Props = {
  importe: string;
  onToken: (datos: DatosTarjeta) => void;
};

//formulario:
export function FormularioTarjeta({ importe, onToken }: Props) {
  const reactId = useId();
  const prefijo = `mp-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const id = (campo: string) => `${prefijo}-${campo}`;

  const onTokenRef = useRef(onToken);
  const [listo, setListo] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    let activo = true;
    let formulario: InstanciaCardForm | undefined;

    const campo = (nombre: string) => `${prefijo}-${nombre}`;

    setListo(false);
    setError("");

    async function montar() {
      try {
        if (!/^\d+\.\d{2}$/.test(importe) || Number(importe) <= 0) {
          throw new Error("El importe debe ser mayor que cero.");
        }

        const mp = await obtenerMercadoPago();
        if (!activo) return;

        formulario = mp.cardForm({
          amount: importe,
          iframe: true,
          form: {
            id: campo("form"),
            cardNumber: {
              id: campo("numero"),
              placeholder: "Número de tarjeta",
            },
            expirationDate: {
              id: campo("vencimiento"),
              placeholder: "MM/AA",
            },
            securityCode: {
              id: campo("cvv"),
              placeholder: "Código de seguridad",
            },
            cardholderName: {
              id: campo("titular"),
              placeholder: "Nombre del titular",
            },
            issuer: {
              id: campo("emisor"),
              placeholder: "Banco emisor",
            },
            installments: {
              id: campo("cuotas"),
              placeholder: "Cuotas",
            },
            identificationType: {
              id: campo("tipo-documento"),
              placeholder: "Tipo de documento",
            },
            identificationNumber: {
              id: campo("documento"),
              placeholder: "Número de documento",
            },
            cardholderEmail: {
              id: campo("email"),
              placeholder: "Correo del comprador",
            },
          },
          callbacks: {
            onFormMounted(errorMontaje) {
              if (!activo) return;

              if (errorMontaje) {
                setError("No se pudo montar el formulario de tarjeta.");
                return;
              }

              setListo(true);
            },

            onSubmit(event) {
              event.preventDefault();
              if (!activo || !formulario) return;

              setError("");

              try {
                const datos = formulario.getCardFormData();

                if (!datos.token || !datos.paymentMethodId) {
                  throw new Error(
                    "No se pudo generar el token. Revisa los datos de la tarjeta.",
                  );
                }

                onTokenRef.current(datos);
              } catch (errorEnvio) {
                setError(
                  errorEnvio instanceof Error
                    ? errorEnvio.message
                    : "No se pudo validar la tarjeta.",
                );
              }
            },
          },
        });
      } catch (errorCarga) {
        if (!activo) return;

        setError(
          errorCarga instanceof Error
            ? errorCarga.message
            : "No se pudo cargar el formulario.",
        );
      }
    }

    void montar();

    return () => {
      activo = false;
      formulario?.unmount();
    };
  }, [importe, prefijo, revision]);

  return (
    <section className="tarjeta-panel panel">
      <h2>Pago con tarjeta</h2>
      <p>Importe de referencia: ${importe} MXN</p>

      <form
        id={id("form")}
        className="tarjeta-form"
        onSubmit={(event) => event.preventDefault()}
      >
        <div>
          <label htmlFor={id("titular")}>Titular</label>
          <input id={id("titular")} type="text" autoComplete="cc-name" />
        </div>

        <div>
          <span>Número de tarjeta</span>
          <div id={id("numero")} className="mp-campo-seguro" />
        </div>

        <div className="tarjeta-fila">
          <div>
            <span>Vencimiento</span>
            <div id={id("vencimiento")} className="mp-campo-seguro" />
          </div>
          <div>
            <span>Código de seguridad</span>
            <div id={id("cvv")} className="mp-campo-seguro" />
          </div>
        </div>

        <div>
          <label htmlFor={id("emisor")}>Banco emisor</label>
          <select id={id("emisor")} />
        </div>

        <div>
          <label htmlFor={id("cuotas")}>Cuotas</label>
          <select id={id("cuotas")} />
        </div>

        <div>
          <label htmlFor={id("tipo-documento")}>Tipo de documento</label>
          <select id={id("tipo-documento")} />
        </div>

        <div>
          <label htmlFor={id("documento")}>Número de documento</label>
          <input id={id("documento")} type="text" />
        </div>

        <div>
          <label htmlFor={id("email")}>Correo del comprador</label>
          <input id={id("email")} type="email" autoComplete="email" />
        </div>

        {!listo && !error && <p role="status">Cargando formulario…</p>}

        {error && (
          <div role="alert">
            <p>{error}</p>
            <button
              type="button"
              onClick={() => setRevision((valor) => valor + 1)}
            >
              Recargar formulario
            </button>
          </div>
        )}

        <button type="submit" className="btn" disabled={!listo}>
          Validar tarjeta de prueba
        </button>
      </form>
    </section>
  );
}