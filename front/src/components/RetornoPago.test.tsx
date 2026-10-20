// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { graphql } from "../api";
import { CONSULTAR_INTENTO, type EstadoCheckout } from "../lib/checkout";
import { RetornoPago } from "./RetornoPago";
import { useEstadoPago } from "../lib/use-estado-pago";

vi.mock("../api", async original => ({
  ...await original<typeof import("../api")>(), graphql: vi.fn(),
}));
const api = vi.mocked(graphql);
function estado(id: string, aprobado = false): EstadoCheckout {
  return {
    intentoId: id, estado: aprobado ? "CONFIRMADO" : "EN_PROCESO",
    pedidoId: aprobado ? 42 : null, total: "99.00", moneda: "MXN",
    modalidad: "ORDERS_API", operacionId: "operacion",
    estadoOperacion: aprobado ? "FINALIZADA" : "INCIERTA",
    aviso: null, checkoutUrl: null, autenticacion: null,
    expiraEn: new Date(Date.now() + 900_000).toISOString(),
    renglones: [{ productoId: 1, cantidad: 1 }],
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem("tl-carrito-v1", JSON.stringify([{ producto: { id: 1 }, cantidad: 2 }]));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("recupera un pago pendiente y muestra su confirmación al consultar, sin cobrar", async () => {
  let aprobado = false;
  api.mockImplementation(async query => {
    expect(query).toBe(CONSULTAR_INTENTO);
    return { estadoIntento: estado("intento", aprobado) };
  });
  render(<RetornoPago intentoId="intento" usuarioId={7} />);
  await screen.findByRole("heading", { name: "Estamos verificando tu pago" });
  expect(JSON.parse(localStorage.getItem("tl-carrito-v1")!)[0].cantidad).toBe(2);
  aprobado = true;
  await waitFor(() => expect((screen.getByRole("button", { name: "Consultar estado" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Consultar estado" }));
  await screen.findByRole("heading", { name: "Pago aprobado" });
  expect(screen.getByText("Tu pedido #42 está pagado.")).toBeTruthy();
  expect(JSON.parse(localStorage.getItem("tl-carrito-v1")!)[0].cantidad).toBe(1);
  expect(api.mock.calls.every(([query]) => query === CONSULTAR_INTENTO)).toBe(true);
});

it("al cambiar de referencia no aplica una respuesta atrasada del intento anterior", async () => {
  let resolverAnterior!: (data: { estadoIntento: EstadoCheckout }) => void;
  api.mockImplementation(async (_, variables) => {
    if (variables?.id === "anterior") return new Promise(resolve => { resolverAnterior = resolve; });
    return { estadoIntento: { ...estado("actual"), estado: "RECHAZADO", estadoOperacion: "FINALIZADA" } };
  });
  const view = render(<RetornoPago intentoId="anterior" usuarioId={7} />);
  await waitFor(() => expect(resolverAnterior).toBeDefined());
  view.rerender(<RetornoPago intentoId="actual" usuarioId={7} />);
  await screen.findByRole("heading", { name: "Pago rechazado" });
  await act(async () => resolverAnterior({ estadoIntento: estado("anterior", true) }));
  await waitFor(() => expect(screen.queryByRole("heading", { name: "Pago aprobado" })).toBeNull());
  expect(JSON.parse(localStorage.getItem("tl-carrito-v1")!)[0].cantidad).toBe(2);
});

it("limita las consultas aunque se enfoque la ventana; permite otra tanda manual sin cobrar", async () => {
  vi.useFakeTimers();
  api.mockImplementation(async () => ({ estadoIntento: estado("incierto") }));
  await act(async () => { render(<RetornoPago intentoId="incierto" usuarioId={7} />); });
  for (let i = 0; i < 16; i++) {
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
  }
  expect(api).toHaveBeenCalledTimes(12);
  expect(screen.getByText(/La consulta automática se ha pausado/)).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
  expect(api).toHaveBeenCalledTimes(12);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Consultar estado" })); });
  expect(api).toHaveBeenCalledTimes(13);
  expect(api.mock.calls.every(([q]) => q === CONSULTAR_INTENTO)).toBe(true);
});

it("no solapa consultas lentas al reenfocar y deja de consultar tras la aprobación", async () => {
  vi.useFakeTimers();
  let resolver!: (data: { estadoIntento: EstadoCheckout }) => void;
  api.mockImplementation(() => new Promise(resolve => { resolver = resolve; }));
  await act(async () => { render(<RetornoPago intentoId="lento" usuarioId={7} />); });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20_000);
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(api).toHaveBeenCalledTimes(1);
  await act(async () => { resolver({ estadoIntento: estado("lento", true) }); });
  expect(screen.getByRole("heading", { name: "Pago aprobado" })).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
  expect(api).toHaveBeenCalledTimes(1);
});

it("iniciar el cobro abre seguimiento aunque la reserva haya agotado sus consultas", async () => {
  vi.useFakeTimers();
  const reserva = { ...estado("reserva"), estado: "INICIADO" as const, operacionId: null, estadoOperacion: null };
  api.mockImplementation(async () => ({ estadoIntento: reserva }));
  const { result } = renderHook(() => useEstadoPago(7));
  await act(async () => { await result.current.recibir(reserva); });
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
  expect(api).toHaveBeenCalledTimes(12);
  expect(result.current.pausado).toBe(true);
  api.mockImplementation(async () => ({ estadoIntento: estado("reserva") }));
  await act(async () => { await result.current.recibir(estado("reserva")); });
  expect(api).toHaveBeenCalledTimes(13);
  expect(result.current.pausado).toBe(false);
});
