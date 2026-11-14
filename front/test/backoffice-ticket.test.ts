// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { backendGraphqlUrl, backendWebSocketUrl } from "../src/lib/server/backend-url";
import { backendResourceUrl } from "../src/lib/server/imagenes";
import { emitirTicketBackOffice } from "../src/pages/api/admin/subscription-ticket";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("dirección del backend", () => {
  it("conserva el servidor local predeterminado exclusivamente en desarrollo", () => {
    vi.stubEnv("BACKEND_GRAPHQL_URL", "");
    vi.stubEnv("DEV", true);
    expect(backendGraphqlUrl()).toBe("http://127.0.0.1:4000/graphql");
    vi.stubEnv("DEV", false);
    expect(() => backendGraphqlUrl()).toThrow("BACKEND_GRAPHQL_URL");
  });
  it("deduce WSS y el origen de las imágenes sin publicar credenciales ni parámetros", () => {
    vi.stubEnv("BACKEND_GRAPHQL_URL", "https://privado:secreto@backend.onrender.com/graphql?key=secreto#fragmento");
    expect(backendWebSocketUrl()).toBe("wss://backend.onrender.com/graphql");
    vi.stubEnv("BACKEND_GRAPHQL_URL", "https://backend.onrender.com/graphql");
    expect(backendResourceUrl("/images/producto.png").href)
      .toBe("https://backend.onrender.com/images/producto.png");
  });
});

describe("ticket de producción", () => {
  it("entrega el destino público de Render después de autenticar sin exponer la sesión", async () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("BACKEND_GRAPHQL_URL", "https://backend.onrender.com/graphql");
    vi.spyOn(console, "info").mockImplementation(() => {});
    const fetch = vi.fn().mockResolvedValue(Response.json({ data: {
      crearTicketBackOffice: { ticket: "ticket-corto", expiraEn: new Date(Date.now() + 60000).toISOString() },
    } }));
    vi.stubGlobal("fetch", fetch);
    const response = await emitirTicketBackOffice(new Request("https://tienda.netlify.app/api/admin/subscription-ticket", {
      method: "POST", headers: { origin: "https://tienda.netlify.app" },
    }), { get: () => ({ value: "sesion-privada" }), delete: vi.fn() });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.wsUrl).toBe("wss://backend.onrender.com/graphql");
    expect(payload.ticket).toBe("ticket-corto");
    expect(JSON.stringify(payload)).not.toContain("sesion-privada");
    expect(fetch.mock.calls[0][0]).toBe("https://backend.onrender.com/graphql");
    expect(fetch.mock.calls[0][1].headers.get("Authorization")).toBe("Bearer sesion-privada");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });
  it("no contacta el backend ni revela su destino sin una sesión", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await emitirTicketBackOffice(new Request("https://tienda.netlify.app/api/admin/subscription-ticket", { method: "POST" }), {
      get: () => undefined, delete: vi.fn(),
    });
    expect(response.status).toBe(401);
    expect((await response.json()).wsUrl).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
});
