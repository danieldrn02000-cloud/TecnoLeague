import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  obtenerMercadoPago, type CampoSeguro, type InstanciaMercadoPago,
  type MetodoTarjeta, type PlanCuotas, type TarjetaTokenizada,
} from "../lib/mercadoPago";

type Props = {
  importe: string;
  procesando?: boolean;
  onToken: (datos: TarjetaTokenizada) => Promise<void>;
};
type Metadatos = {
  metodo: MetodoTarjeta;
  emisores: { id: string | number; name: string }[];
  planes: PlanCuotas[];
};
function costosDisponibles(datos: Metadatos, emisor: string) {
  if (datos.metodo.payment_type_id === "debit_card") return [{ installments: 1, recommended_message: "Un solo pago" }];
  return datos.planes.filter(p =>
    (!p.payment_method_id || p.payment_method_id === datos.metodo.id) &&
    (!p.issuer?.id || String(p.issuer.id) === emisor),
  ).flatMap(p => p.payer_costs).filter(p => p.installments >= 1 && p.installments <= 36);
}

export function FormularioTarjeta({ importe, procesando = false, onToken }: Props) {
  const reactId = useId();
  const prefijo = `mp-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const id = (campo: string) => `${prefijo}-${campo}`;
  const [listo, setListo] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [enviandoToken, setEnviandoToken] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [metadatos, setMetadatos] = useState<Metadatos | null>(null);
  const [emisor, setEmisor] = useState("");
  const [cuotas, setCuotas] = useState("");
  const sdk = useRef<InstanciaMercadoPago | null>(null);
  const enviando = useRef(false);
  const montado = useRef(false);
  const versionBin = useRef(0);

  useEffect(() => {
    let activo = true;
    montado.current = true;
    const campos: CampoSeguro[] = [];
    setListo(false);
    setMetadatos(null);
    setCargando(false);
    setEmisor("");
    setCuotas("");
    setError("");
    async function montar() {
      try {
        if (!/^\d+\.\d{2}$/.test(importe) || Number(importe) <= 0) throw new Error("El importe debe ser mayor que cero.");
        const mp = await obtenerMercadoPago();
        if (!activo) return;
        sdk.current = mp;
        const tipos = ["cardNumber", "expirationDate", "securityCode"] as const;
        const nombres = ["numero", "vencimiento", "cvv"];
        const textos = ["Número de tarjeta", "MM/AA", "Código de seguridad"];
        let preparados = 0;
        for (const [indice, tipo] of tipos.entries()) {
          const campo = mp.fields.create(tipo, { placeholder: textos[indice] });
          campos.push(campo);
          campo.on("ready", () => { if (activo && ++preparados === 3) setListo(true); });
          campo.on("error", () => { if (activo) setError("No se pudo cargar un campo de tarjeta. Recarga el formulario."); });
        }
        campos[0].on("binChange", async ({ bin }) => {
          const version = ++versionBin.current;
          if (!activo) return;
          setMetadatos(null);
          setCuotas("");
          setEmisor("");
          setError("");
          setCargando(!!bin);
          if (!bin) return;
          try {
            const respuesta = await mp.getPaymentMethods({ bin });
            if (!activo || version !== versionBin.current) return;
            const metodo = respuesta.results.find(m => ["credit_card", "debit_card"].includes(m.payment_type_id));
            if (!metodo) throw new Error("Esta tarjeta no tiene un método de pago compatible.");
            const ajustes = metodo.settings?.[0];
            if (ajustes?.card_number) campos[0].update({ settings: ajustes.card_number });
            if (ajustes?.security_code) campos[2].update({ settings: ajustes.security_code });
            const [emisores, planes] = await Promise.all([
              mp.getIssuers({ paymentMethodId: metodo.id, bin }),
              metodo.payment_type_id === "debit_card" ? Promise.resolve([]) : mp.getInstallments({ amount: importe, bin }),
            ]);
            if (!activo || version !== versionBin.current) return;
            const datos = { metodo, emisores, planes };
            const banco = String(emisores[0]?.id ?? "");
            const opciones = costosDisponibles(datos, banco);
            if (!opciones.length) throw new Error("No hay opciones de pago disponibles para esta tarjeta.");
            setMetadatos(datos);
            setEmisor(banco);
            setCuotas(String(opciones.find(p => p.installments === 1)?.installments ?? opciones[0].installments));
          } catch {
            if (activo && version === versionBin.current) setError("No pudimos consultar el banco y las opciones de pago. Revisa la tarjeta o recarga el formulario.");
          } finally {
            if (activo && version === versionBin.current) setCargando(false);
          }
        });
        campos.forEach((campo, i) => campo.mount(`${prefijo}-${nombres[i]}`));
      } catch (e) {
        if (activo) setError(e instanceof Error ? e.message : "No se pudo cargar el formulario.");
      }
    }
    void montar();
    return () => {
      activo = false;
      montado.current = false;
      ++versionBin.current;
      sdk.current = null;
      campos.forEach(campo => campo.unmount());
    };
  }, [importe, prefijo, revision]);

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (enviando.current || procesando || !listo || cargando || !metadatos || !sdk.current) return;
    const tipo = metadatos.metodo.payment_type_id;
    if (tipo !== "credit_card" && tipo !== "debit_card") return;
    if (!costosDisponibles(metadatos, emisor).some(p => String(p.installments) === cuotas)) return;
    const titular = String(new FormData(event.currentTarget).get("titular") ?? "").trim();
    if (!titular) { setError("Escribe el nombre del titular."); return; }
    const version = versionBin.current;
    enviando.current = true;
    setEnviandoToken(true);
    setError("");
    try {
      const token = await sdk.current.fields.createCardToken({ cardholderName: titular });
      if (!montado.current) return;
      if (version !== versionBin.current) throw new Error("La tarjeta cambió. Revisa los datos antes de continuar.");
      if (!token?.id) throw new Error("No se pudo validar la tarjeta.");
      await onToken({ token: token.id, paymentMethodId: metadatos.metodo.id, paymentTypeId: tipo, installments: cuotas });
    } catch {
      if (montado.current) setError("No se pudo validar la tarjeta. Revisa los datos e intenta nuevamente.");
    } finally {
      enviando.current = false;
      if (montado.current) setEnviandoToken(false);
    }
  }

  const costos = metadatos ? costosDisponibles(metadatos, emisor) : [];
  return (
    <section className="tarjeta-panel panel">
      <h2>Pago con tarjeta</h2>
      <p>Total confirmado: ${importe} MXN</p>
      <form className="tarjeta-form" onSubmit={enviar}>
        <fieldset disabled={procesando || enviandoToken}>
          <div><label htmlFor={id("titular")}>Titular</label><input id={id("titular")} name="titular" required autoComplete="cc-name" maxLength={120} /></div>
          <div><span>Número de tarjeta</span><div id={id("numero")} className="mp-campo-seguro" /></div>
          <div className="tarjeta-fila">
            <div><span>Vencimiento</span><div id={id("vencimiento")} className="mp-campo-seguro" /></div>
            <div><span>Código de seguridad</span><div id={id("cvv")} className="mp-campo-seguro" /></div>
          </div>
          <div>
            <label htmlFor={id("emisor")}>Banco emisor</label>
            <select id={id("emisor")} value={emisor} disabled={!metadatos} onChange={e => { setEmisor(e.target.value); setCuotas(""); }}>
              {!metadatos?.emisores.length && <option value="">Se identifica con la tarjeta</option>}
              {metadatos?.emisores.map(b => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={id("cuotas")}>Cuotas</label>
            <select id={id("cuotas")} value={cuotas} required disabled={!metadatos} onChange={e => setCuotas(e.target.value)}>
              <option value="">Selecciona una opción</option>
              {costos.map((p, i) => <option key={`${p.installments}-${i}`} value={String(p.installments)}>{p.recommended_message}</option>)}
            </select>
          </div>
          {!listo && !error && <p role="status">Cargando formulario…</p>}
          {cargando && <p role="status">Consultando opciones de la tarjeta…</p>}
          {error && <div role="alert"><p>{error}</p><button type="button" onClick={() => setRevision(n => n + 1)}>Recargar formulario</button></div>}
          <button type="submit" className="btn" disabled={!listo || !metadatos || !cuotas || cargando || procesando || enviandoToken}>
            {procesando || enviandoToken ? "Procesando…" : `Pagar $${importe} MXN`}
          </button>
        </fieldset>
      </form>
    </section>
  );
}
