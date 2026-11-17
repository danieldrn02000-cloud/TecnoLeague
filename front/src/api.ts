import { useCallback, useEffect, useState } from "react";
export class GraphQLError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "GraphQLError";
  }
}

let redirigiendoAlLogin = false;
export const PRODUCTO =
  "id nombre descripcion precio imagen stock marca especificaciones categoria { id nombre }";
export const PEDIDO = `id folio fecha total status nombre email direccion metodoPago trackingNumber trackingCarrierName trackingStatus trackingDescription trackingUpdatedAt detalles { id cantidad nombreProducto precioUnitario subtotal producto { ${PRODUCTO} } }`;
export async function graphql<T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api/graphql", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error(
      "No hay conexión con la tienda. Comprueba que el servidor esté iniciado y vuelve a intentar.",
    );
  }
  const body = (await response.json().catch(() => null)) as {
    data?: T;
    errors?: {
      message: string;
      extensions?: { code?: string };
    }[];
  } | null;

  if (body?.errors?.length) {
    const fallo =
      body.errors.find(
        (error) => error.extensions?.code === "UNAUTHENTICATED",
      ) ?? body.errors[0];

    const code = fallo.extensions?.code;

    if (
      code === "UNAUTHENTICATED" &&
      typeof window !== "undefined" &&
      !redirigiendoAlLogin
    ) {
      redirigiendoAlLogin = true;

      const next = window.location.pathname + window.location.search;

      window.dispatchEvent(new Event("tl-sesion-invalida"));

      window.location.replace(
        `/iniciar-sesion?reason=sesion&next=${encodeURIComponent(next)}`,
      );
      window.location.replace(
        `/iniciar-sesion?reason=sesion&next=${encodeURIComponent(next)}`,
      );
    }

    throw new GraphQLError(fallo.message, code);
  }

  if (!response.ok || !body?.data) {
    throw new Error(
      "El servidor no pudo responder. Intenta de nuevo en unos segundos.",
    );
  }

  return body.data;
}
export function useQuery<T>(
  query: string,
  variables: Record<string, unknown> = {},
) {
  const key = JSON.stringify(variables);
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    let vigente = true;
    setLoading(true);
    setError("");
    graphql<T>(query, JSON.parse(key))
      .then((d) => {
        if (vigente) setData(d);
      })
      .catch((e) => {
        if (vigente) setError(e.message);
      })
      .finally(() => {
        if (vigente) setLoading(false);
      });
    return () => {
      vigente = false;
    };
  }, [query, key, revision]);
  return { data, loading, error, retry };
}
export const dinero = (valor: number) =>
  new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 2,
  }).format(valor);
