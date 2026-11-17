// @vitest-environment node
import type { APIContext } from "astro";
import { afterEach, expect, it, vi } from "vitest";
import { GET } from "../src/pages/images/uploads/[archivo]";

const archivo = "12345678-1234-1234-1234-123456789abc.png";
const contexto = (nombre = archivo) =>
  ({ params: { archivo: nombre } }) as unknown as APIContext;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("sirve a visitantes sin sesión la imagen guardada en el backend de Render", async () => {
  vi.stubEnv("BACKEND_GRAPHQL_URL", "https://backend.onrender.com/graphql");
  const contenido = new Uint8Array([137, 80, 78, 71]);
  const fetch = vi.fn().mockResolvedValue(new Response(contenido));
  vi.stubGlobal("fetch", fetch);
  // No hay cookies ni sesión en el contexto de este visitante.
  const response = await GET(contexto());
  expect(response.status).toBe(200);
  expect(fetch.mock.calls[0][0].href).toBe(
    `https://backend.onrender.com/imagenes/${archivo}`,
  );
  expect(fetch.mock.calls[0][1].headers).toBeUndefined();
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(contenido);
  expect(response.headers.get("Content-Type")).toBe("image/png");
  expect(response.headers.get("Cache-Control")).toContain("public");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
});

it("conserva el 404 del backend para un archivo que ya no existe", async () => {
  vi.stubEnv("BACKEND_GRAPHQL_URL", "https://backend.onrender.com/graphql");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
  expect((await GET(contexto())).status).toBe(404);
});

it("sirve los formatos nuevos normalizados a WebP", async () => {
  vi.stubEnv("BACKEND_GRAPHQL_URL", "https://backend.onrender.com/graphql");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]))));
  const response = await GET(contexto(archivo.replace(".png", ".webp")));
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("image/webp");
});

it("rechaza rutas arbitrarias antes de consultar el backend", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect((await GET(contexto("../../secreto.env"))).status).toBe(404);
  expect(fetch).not.toHaveBeenCalled();
});
