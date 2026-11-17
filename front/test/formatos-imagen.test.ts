import { expect, it } from "vitest";
import { tipoImagen } from "../src/lib/formatos-imagen";

it.each([
  ["foto.avif", "image/avif", "image/avif"],
  ["foto.WEBP", "image/webp", "image/webp"],
  ["foto.gif", "image/gif", "image/gif"],
  ["foto.tif", "image/tiff", "image/tiff"],
  ["foto.tiff", "image/x-tiff", "image/tiff"],
  ["foto.avif", "", "image/avif"],
  ["foto.avif", "application/octet-stream", "image/avif"],
  ["foto.png", "image/png", "image/png"],
  ["foto.jpeg", "image/jpeg", "image/jpeg"],
])("acepta %s y normaliza el tipo %s", (nombre, tipo, esperado) => {
  expect(tipoImagen(nombre, tipo)).toBe(esperado);
});
it("rechaza SVG, ejecutables y discrepancias entre extensión y MIME", () => {
  expect(tipoImagen("foto.svg", "image/svg+xml")).toBeNull();
  expect(tipoImagen("foto.exe", "image/png")).toBeNull();
  expect(tipoImagen("foto.avif", "image/png")).toBeNull();
});
