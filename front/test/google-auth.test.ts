// @vitest-environment node
import type { APIContext } from "astro";
import { afterEach, expect, it, vi } from "vitest";
import { POST } from "../src/pages/api/auth/google";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
function contexto(
  body: object,
  origin = "https://tienda.test",
  nonce?: string,
) {
  const cookies = {
    get: vi.fn(() => (nonce ? { value: nonce } : undefined)),
    set: vi.fn(),
    delete: vi.fn(),
  };
  return {
    request: new Request("https://tienda.test/api/auth/google", {
      method: "POST",
      headers: { origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    cookies,
  } as unknown as APIContext;
}

it("crea un nonce impredecible, breve y protegido en una cookie HttpOnly", async () => {
  const ctx = contexto({ accion: "preparar" });
  const response = await POST(ctx);
  const body = await response.json();
  expect(body.nonce).toMatch(/^[\w-]{43}$/);
  expect(ctx.cookies.set).toHaveBeenCalledWith(
    "tl_google_nonce",
    body.nonce,
    expect.objectContaining({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 600,
    }),
  );
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});

it("rechaza otro origen y solicitudes sin nonce antes de contactar al backend", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect(
    (await POST(contexto({ accion: "preparar" }, "https://otro.test"))).status,
  ).toBe(403);
  expect((await POST(contexto({ credential: "token" }))).status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});

it("envía nonce y credencial al puente, conserva el JWT en HttpOnly y consume el nonce", async () => {
  vi.stubEnv("BACKEND_GRAPHQL_URL", "https://backend.test/graphql");
  vi.stubEnv("AUTH_BRIDGE_SECRET", "puente-privado");
  const fetch = vi.fn().mockResolvedValue(
    Response.json({
      data: {
        iniciarSesionGoogle: {
          token: "jwt-privado",
          usuario: {
            id: 1,
            nombre: "Cliente",
            email: "a@test.com",
            rol: "CLIENTE",
          },
        },
      },
    }),
  );
  vi.stubGlobal("fetch", fetch);
  const ctx = contexto(
    { credential: "token-google" },
    "https://tienda.test",
    "nonce-cookie",
  );
  const response = await POST(ctx);
  expect(response.status).toBe(200);
  expect(JSON.stringify(await response.json())).not.toContain("jwt-privado");
  expect(ctx.cookies.set).toHaveBeenCalledWith(
    "tl_session",
    "jwt-privado",
    expect.objectContaining({ httpOnly: true, secure: true }),
  );
  expect(ctx.cookies.delete).toHaveBeenCalledWith("tl_google_nonce", {
    path: "/api/auth/google",
  });
  expect(JSON.parse(fetch.mock.calls[0][1].body).variables.datos).toEqual({
    credential: "token-google",
    nonce: "nonce-cookie",
  });
  expect(fetch.mock.calls[0][1].headers.get("x-auth-bridge-secret")).toBe(
    "puente-privado",
  );
});

it("mantiene el nonce únicamente para confirmar la vinculación sin crear una sesión", async () => {
  vi.stubEnv("BACKEND_GRAPHQL_URL", "https://backend.test/graphql");
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json({
          errors: [
            {
              message: "Confirma tu contraseña",
              extensions: { code: "GOOGLE_LINK_REQUIRED" },
            },
          ],
        }),
      ),
  );
  const ctx = contexto(
    { credential: "token-google" },
    "https://tienda.test",
    "nonce-cookie",
  );
  expect((await POST(ctx)).status).toBe(409);
  expect(ctx.cookies.set).not.toHaveBeenCalled();
  expect(ctx.cookies.delete).not.toHaveBeenCalled();
});
