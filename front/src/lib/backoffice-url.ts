export function backOfficeUrl(
  configured: string | undefined,
  development: boolean,
  page: string,
) {
  const location = new URL(page);
  // El proxy de Vite evita direcciones loopback y abrir otro puerto en la LAN.
  if (!configured?.trim() && development) {
    const url = new URL("/api/backoffice-ws", location);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    return url.toString();
  }
  if (!configured?.trim()) {
    throw new Error(
      "Configura PUBLIC_BACKOFFICE_WS_URL con el WebSocket público de NestJS.",
    );
  }
  const url = new URL(configured.trim());
  if (!["ws:", "wss:"].includes(url.protocol)) {
    throw new Error("PUBLIC_BACKOFFICE_WS_URL debe usar ws:// o wss://.");
  }
  if (location.protocol === "https:" && url.protocol !== "wss:") {
    throw new Error(
      "El sitio usa HTTPS: configura PUBLIC_BACKOFFICE_WS_URL con wss://.",
    );
  }
  const loopback = (host: string) =>
    ["localhost", "127.0.0.1", "[::1]"].includes(host);
  if (loopback(url.hostname) && !loopback(location.hostname)) {
    throw new Error(
      "El WebSocket apunta a localhost. Deja PUBLIC_BACKOFFICE_WS_URL vacía en desarrollo para usar la red local.",
    );
  }
  return url.toString();
}
