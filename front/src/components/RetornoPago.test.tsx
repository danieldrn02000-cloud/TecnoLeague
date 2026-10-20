// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { graphql } from "../api";
import { CONSULTAR_INTENTO, type EstadoCheckout } from "../lib/checkout";
import { RetornoPago } from "./RetornoPago";

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
afterEach(cleanup);

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
