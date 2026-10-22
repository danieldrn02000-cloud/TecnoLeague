// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { backOfficeUrl } from "../src/lib/backoffice-url";
import { ProductImageField } from "../src/components/ProductImageField";
import { useBackOfficeEvents } from "../src/hooks/useBackOfficeEvents";

const ws = vi.hoisted(() => ({
  options: null as any,
  sink: null as any,
  dispose: vi.fn(),
  unsubscribe: vi.fn(),
  create: vi.fn(),
}));
vi.mock("graphql-ws", () => ({
  createClient: (options: any) => {
    ws.options = options;
    ws.create(options);
    return {
      subscribe: (_query: any, sink: any) => {
        ws.sink = sink;
        return ws.unsubscribe;
      },
      dispose: ws.dispose,
    };
  },
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("destino WebSocket", () => {
  it("usa el origen actual en la laptop y en otra computadora de la LAN", () => {
    expect(backOfficeUrl("", true, "http://localhost:5173")).toBe(
      "ws://localhost:5173/api/backoffice-ws",
    );
    expect(backOfficeUrl(undefined, true, "http://192.168.1.20:5173")).toBe(
      "ws://192.168.1.20:5173/api/backoffice-ws",
    );
    expect(backOfficeUrl("", true, "https://tienda.test")).toBe(
      "wss://tienda.test/api/backoffice-ws",
    );
  });
  it("requiere un destino público seguro en producción", () => {
    expect(() => backOfficeUrl("", false, "https://tienda.test")).toThrow(
      "PUBLIC_BACKOFFICE_WS_URL",
    );
    expect(() =>
      backOfficeUrl("ws://backend.test/graphql", false, "https://tienda.test"),
    ).toThrow("wss://");
    expect(() =>
      backOfficeUrl(
        "ws://127.0.0.1:4000/graphql",
        true,
        "http://192.168.1.20:5173",
      ),
    ).toThrow("localhost");
    expect(
      backOfficeUrl("wss://backend.test/graphql", false, "https://tienda.test"),
    ).toBe("wss://backend.test/graphql");
  });
});

describe("Añadir imagen", () => {
  it("abre el explorador, sube PNG y conserva la ruta devuelta para guardar el producto", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ imagen: "/images/uploads/123.png" }));
    vi.stubGlobal("fetch", fetch);
    const uploading = vi.fn();
    render(<ProductImageField disabled={false} onUploading={uploading} />);
    const input = screen.getByLabelText(
      "Seleccionar imagen del producto",
    ) as HTMLInputElement;
    const click = vi.spyOn(input, "click");
    fireEvent.click(screen.getByRole("button", { name: "Añadir imagen" }));
    expect(click).toHaveBeenCalledOnce();
    fireEvent.change(input, {
      target: { files: [new File(["png"], "foto.png", { type: "image/png" })] },
    });
    await waitFor(() =>
      expect((screen.getByLabelText("Imagen") as HTMLInputElement).value).toBe(
        "/images/uploads/123.png",
      ),
    );
    expect(fetch.mock.calls[0][0]).toBe("/api/admin/imagenes");
    expect(fetch.mock.calls[0][1].body.get("imagen").name).toBe("foto.png");
    expect(uploading.mock.calls).toEqual([[true], [false]]);
    expect(
      screen.getByAltText("Vista previa del producto").getAttribute("src"),
    ).toBe("/images/uploads/123.png");
  });
  it.each(["jpg", "jpeg"])(
    "acepta extensión %s con MIME JPEG",
    async (extension) => {
      const fetch = vi
        .fn()
        .mockResolvedValue(
          Response.json({ imagen: "/images/uploads/foto.jpg" }),
        );
      vi.stubGlobal("fetch", fetch);
      render(<ProductImageField disabled={false} onUploading={vi.fn()} />);
      fireEvent.change(
        screen.getByLabelText("Seleccionar imagen del producto"),
        {
          target: {
            files: [
              new File(["jpg"], `foto.${extension}`, { type: "image/jpeg" }),
            ],
          },
        },
      );
      await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
      await waitFor(() =>
        expect(screen.queryByText("Subiendo imagen…")).toBeNull(),
      );
    },
  );
  it("rechaza formatos y tamaños inválidos sin enviar una petición", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<ProductImageField disabled={false} onUploading={vi.fn()} />);
    const input = screen.getByLabelText("Seleccionar imagen del producto");
    fireEvent.change(input, {
      target: {
        files: [new File(["<svg/>"], "foto.svg", { type: "image/svg+xml" })],
      },
    });
    expect(screen.getByRole("alert").textContent).toContain("JPG, JPEG o PNG");
    fireEvent.change(input, {
      target: {
        files: [
          new File([new Uint8Array(5 * 1024 * 1024 + 1)], "foto.jpg", {
            type: "image/jpeg",
          }),
        ],
      },
    });
    expect(screen.getByRole("alert").textContent).toContain("hasta 5 MB");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("conserva la imagen anterior y muestra el error del servidor", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: "La sesión expiró." }, { status: 401 }),
        ),
    );
    render(
      <ProductImageField
        initialImage="/images/gpu.png"
        disabled={false}
        onUploading={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Seleccionar imagen del producto"), {
      target: { files: [new File(["png"], "foto.png", { type: "image/png" })] },
    });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("La sesión expiró."),
    );
    expect((screen.getByLabelText("Imagen") as HTMLInputElement).value).toBe(
      "/images/gpu.png",
    );
  });
});

describe("conexión administrativa", () => {
  beforeEach(() => {
    vi.stubEnv("PUBLIC_BACKOFFICE_WS_URL", "");
    vi.stubEnv("DEV", true);
  });
  it("agrupa y deduplica eventos; al reconectar recupera datos y al salir libera la conexión", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const reconnect = vi.fn();
    window.addEventListener("tl-backoffice-refresh", refresh);
    window.addEventListener("tl-backoffice-reconnected", reconnect);
    const { result, unmount } = renderHook(() => useBackOfficeEvents(vi.fn()));
    act(() => ws.options.on.connected());
    expect(result.current.estado).toBe("connected");
    const evento = {
      eventoId: "1",
      entidad: "PRODUCTO",
      entidadId: 10,
      accion: "CREADO",
      ocurridoEn: "2026-10-22",
    };
    act(() => {
      ws.sink.next({ data: { backOfficeActualizado: evento } });
      ws.sink.next({ data: { backOfficeActualizado: evento } });
      vi.advanceTimersByTime(200);
    });
    expect(refresh).toHaveBeenCalledOnce();
    expect(refresh.mock.calls[0][0].detail).toHaveLength(1);
    act(() => {
      ws.options.on.closed();
      ws.options.on.connected();
    });
    expect(reconnect).toHaveBeenCalledOnce();
    unmount();
    expect(ws.unsubscribe).toHaveBeenCalledOnce();
    expect(ws.dispose).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    window.removeEventListener("tl-backoffice-refresh", refresh);
    window.removeEventListener("tl-backoffice-reconnected", reconnect);
  });
  it("solicita un ticket nuevo por conexión y no reintenta ante 403", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: "Sin permiso." }, { status: 403 }),
        ),
    );
    const { result } = renderHook(() => useBackOfficeEvents(vi.fn()));
    await act(async () => {
      await expect(ws.options.connectionParams()).rejects.toThrow(
        "Sin permiso.",
      );
    });
    expect(result.current.estado).toBe("denied");
    expect(ws.options.shouldRetry()).toBe(false);
    expect(result.current.detalle).toContain("acceso administrativo");
  });
  it("permite reconectar manualmente sin mantener el cliente anterior", () => {
    const { result } = renderHook(() => useBackOfficeEvents(vi.fn()));
    act(() => result.current.reintentar());
    expect(ws.create).toHaveBeenCalledTimes(2);
    expect(ws.unsubscribe).toHaveBeenCalledOnce();
    expect(ws.dispose).toHaveBeenCalledOnce();
  });
});
