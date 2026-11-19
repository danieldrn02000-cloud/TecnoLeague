import { useState, type FormEvent } from "react";
import { graphql, useQuery } from "../api";
import { Cargando, ErrorCarga } from "../components/ui";
import { CAMPOS_GUIA, CAMPOS_RESPUESTA_GUIA, CONSULTA_GUIA, textosGuia, type GuiaGamer } from "../lib/guia-gamer";

const SECCIONES = [
  ["introduccion", "Introducción"], ["empezar", "Primeros pasos"],
  ["componentes", "Componentes de PC"], ["ram", "RAM y DDR"],
  ["almacenamiento", "Almacenamiento"], ["graficas", "Tarjetas gráficas"],
  ["marcas", "Empresas y componentes"], ["consolas", "Consolas"],
  ["elegir", "Consejos y preguntas frecuentes"], ["glosario", "Glosario"],
  ["cierre", "Cierre de la guía"],
];

const ETIQUETAS_INTRODUCCION: Record<string, string> = {
  "introduccion.descripcion": "Descripción para buscadores",
  "introduccion.texto1": "Texto sobre el título",
  "introduccion.texto2": "Título principal",
  "introduccion.texto3": "Párrafo de introducción",
  "introduccion.texto4": "Primer destacado",
  "introduccion.texto5": "Segundo destacado",
  "introduccion.texto6": "Tercer destacado",
};

export function EditarGuiaGamer({ avisar }: { avisar: (mensaje: string) => void }) {
  const { data, loading, error, retry } = useQuery<{ guiaGamer: GuiaGamer }>(CONSULTA_GUIA);
  if (loading) return <Cargando />;
  if (error || !data) return <ErrorCarga mensaje={error || "No se pudo consultar la guía."} reintentar={retry} />;
  return <FormularioGuia guia={data.guiaGamer} avisar={avisar} />;
}

function FormularioGuia({ guia, avisar }: { guia: GuiaGamer; avisar: (mensaje: string) => void }) {
  const [guardada, setGuardada] = useState(guia);
  const [borrador, setBorrador] = useState(() => Object.fromEntries(guia.textos.map(({ clave, texto }) => [clave, texto])));
  const [seccion, setSeccion] = useState("introduccion");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const textoActual = textosGuia(guardada);
  const campos = Object.entries(CAMPOS_GUIA);
  const hayCambios = campos.some(([clave, original]) => (borrador[clave] ?? original).trim() !== textoActual(clave));

  async function guardar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !hayCambios) return;
    const textos = campos.flatMap(([clave, original]) => {
      const texto = (borrador[clave] ?? original).trim();
      return texto === original ? [] : [{ clave, texto }];
    });
    setBusy(true);
    setError("");
    try {
      const data = await graphql<{ guardarGuiaGamer: GuiaGamer }>(
        `mutation GuardarGuia($revision: Int!, $textos: [TextoGuiaGamerInput!]!) {
          guardarGuiaGamer(revision: $revision, textos: $textos) { ${CAMPOS_RESPUESTA_GUIA} }
        }`, { revision: guardada.revision, textos },
      );
      setGuardada(data.guardarGuiaGamer);
      setBorrador(Object.fromEntries(data.guardarGuiaGamer.textos.map(({ clave, texto }) => [clave, texto])));
      avisar("Se publicó el texto de la guía gamer.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la guía.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel admin-panel guia-editor" onSubmit={guardar}>
      <div className="admin-tools">
        <label>Sección
          <select value={seccion} onChange={(event) => setSeccion(event.target.value)} disabled={busy}>
            {SECCIONES.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
          </select>
        </label>
        <a className="btn btn-secondary" href="/guia-gamer" target="_blank" rel="noreferrer">Ver guía publicada</a>
      </div>
      <p className="muted">Edita los textos por sección. Guardar publica todos los cambios pendientes.</p>
      <fieldset disabled={busy} className="guia-editor-campos">
        {campos.filter(([clave]) => clave.startsWith(seccion + ".")).map(([clave, original], i) => (
          <label key={clave}>
            {ETIQUETAS_INTRODUCCION[clave] ?? (clave.endsWith(".indice") ? "Texto en el índice" : `Texto ${i + 1}`)}
            <textarea value={borrador[clave] ?? original}
              rows={original.length > 90 ? 4 : 2} maxLength={2000} required
              onChange={(event) => setBorrador((previo) => ({ ...previo, [clave]: event.target.value }))} />
          </label>
        ))}
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="btn" disabled={busy || !hayCambios}>{busy ? "Guardando…" : "Guardar y publicar"}</button>
    </form>
  );
}
