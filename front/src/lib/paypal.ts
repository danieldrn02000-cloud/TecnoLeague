export function urlPayPalValida(valor: string): boolean {
  try {
    const url = new URL(valor);
    return url.protocol === "https:" && ["www.sandbox.paypal.com", "www.paypal.com"].includes(url.hostname) && !url.username && !url.password && !url.port;
  } catch { return false; }
}
export function abrirPayPal(url: string) {
  if (!urlPayPalValida(url)) throw new Error("No pudimos abrir PayPal. Vuelve a consultar tu compra.");
  window.location.assign(url);
}
