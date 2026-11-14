export function backOfficeUrl(
  configured: string | undefined,
  development: boolean,
  page: string,
  backendUrl?: string,
) {
  const location = new URL(page);
  // El proxy de Vite evita direcciones loopback y abrir otro puerto en la LAN.
  if (!configured?.trim() && development) {
    const url = new URL("/api/backoffice-ws", location);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    return url.toString();
  }
  const destination = configured?.trim() || backendUrl?.trim();
  if (!destination) {
    throw new Error(
      "No se recibió la dirección de las actualizaciones en vivo. Comprueba BACKEND_GRAPHQL_URL en Netlify.",
    );
  }
  const url = new URL(destination);
  if (!["ws:", "wss:"].includes(url.protocol)) {
    throw new Error("La dirección del WebSocket debe usar ws:// o wss://.");
  }
  if (location.protocol === "https:" && url.protocol !== "wss:") {
    throw new Error(
      "El sitio usa HTTPS: el WebSocket de NestJS debe usar wss://.",
    );
  }
  const loopback = (host: string) =>
    ["localhost", "127.0.0.1", "[::1]"].includes(host);
  if (loopback(url.hostname) && !loopback(location.hostname)) {
    throw new Error(
      development
        ? "El WebSocket apunta a localhost. Deja PUBLIC_BACKOFFICE_WS_URL vacía en desarrollo para usar la red local."
        : "El WebSocket apunta a localhost. Configura BACKEND_GRAPHQL_URL con la dirección pública de NestJS en Netlify.",
    );
  }
  return url.toString();
}
