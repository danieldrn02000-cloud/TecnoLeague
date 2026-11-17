export const FORMATOS_IMAGEN = "JPG, JPEG, PNG, AVIF, WebP, GIF o TIFF";
export const ACEPTAR_IMAGENES =
  ".jpg,.jpeg,.png,.avif,.webp,.gif,.tif,.tiff,image/jpeg,image/png,image/avif,image/webp,image/gif,image/tiff";

export function tipoImagen(nombre: string, tipo: string) {
  const tipos: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    avif: "image/avif",
    webp: "image/webp",
    gif: "image/gif",
    tif: "image/tiff",
    tiff: "image/tiff",
  };
  const esperado = tipos[nombre.split(".").pop()?.toLowerCase() || ""];
  const recibido = tipo === "image/x-tiff" ? "image/tiff" : tipo.toLowerCase();
  return esperado &&
    (!recibido ||
      recibido === "application/octet-stream" ||
      recibido === esperado)
    ? esperado
    : null;
}
