// Solo se importa desde rutas del servidor: esta variable nunca llega al cliente.
export function backendGraphqlUrl() {
  const configured =
    process.env.BACKEND_GRAPHQL_URL?.trim() ||
    import.meta.env.BACKEND_GRAPHQL_URL?.trim();
  if (configured) return configured;
  if (import.meta.env.DEV) return "http://127.0.0.1:4000/graphql";
  throw new Error("Configura BACKEND_GRAPHQL_URL con la URL pública de NestJS.");
}

export function backendWebSocketUrl() {
  const url = new URL(backendGraphqlUrl());
  if (!["https:", "http:"].includes(url.protocol)) {
    throw new Error("BACKEND_GRAPHQL_URL debe usar HTTP o HTTPS.");
  }
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  // Publicar únicamente el destino; nunca credenciales ni parámetros privados.
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.toString();
}
