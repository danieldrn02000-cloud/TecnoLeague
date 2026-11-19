import originales from "./guia-gamer-default.json";

export type TextoGuia = { clave: string; texto: string };
export type GuiaGamer = { revision: number; textos: TextoGuia[] };
export const CAMPOS_GUIA: Record<string, string> = originales;
export const CAMPOS_RESPUESTA_GUIA = "revision textos { clave texto }";
export const CONSULTA_GUIA = `query GuiaPublica { guiaGamer { ${CAMPOS_RESPUESTA_GUIA} } }`;

export function textosGuia(guia?: GuiaGamer) {
  const cambios = new Map(guia?.textos.map(({ clave, texto }) => [clave, texto]));
  return (clave: string) => cambios.get(clave) ?? CAMPOS_GUIA[clave] ?? "";
}
