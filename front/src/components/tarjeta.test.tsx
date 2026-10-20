// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { obtenerMercadoPago, type CampoSeguro, type MetodoTarjeta } from "../lib/mercadoPago";
import { FormularioTarjeta } from "./tarjeta";
vi.mock("../lib/mercadoPago", () => ({ obtenerMercadoPago: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function sdkSimulado() {
  const listeners = new Map<string, Map<string, (event: { bin?: string | null }) => void>>();
  const unmount = vi.fn();
  const createCardToken = vi.fn(async () => ({ id: "token-efimero" }));
  const getPaymentMethods = vi.fn(async (): Promise<{ results: MetodoTarjeta[] }> => ({ results: [{ id: "visa", name: "Visa", payment_type_id: "debit_card" }] }));
  const getIssuers = vi.fn(async () => [{ id: "1", name: "Banco de prueba" }]);
  const getInstallments = vi.fn(async () => [{ payment_method_id: "master", payer_costs: [{ installments: 1, recommended_message: "Un pago" }, { installments: 3, recommended_message: "Tres cuotas" }] }]);
  vi.mocked(obtenerMercadoPago).mockResolvedValue({
    fields: {
      create: tipo => {
        const eventos = new Map<string, (event: { bin?: string | null }) => void>();
        listeners.set(tipo, eventos);
        const campo: CampoSeguro = {
          on: (evento, callback) => { eventos.set(evento, callback); },
          mount: () => { eventos.get("ready")?.({}); return campo; },
          update: vi.fn(), unmount,
        };
        return campo;
      },
      createCardToken,
    },
    getPaymentMethods, getIssuers, getInstallments,
  });
  return { listeners, unmount, createCardToken, getPaymentMethods, getIssuers, getInstallments };
}

it("tokeniza en campos seguros sin correo ni documento y bloquea el doble envío", async () => {
  const sdk = sdkSimulado();
  let terminar!: () => void;
  const onToken = vi.fn(() => new Promise<void>(resolve => { terminar = resolve; }));
  const view = render(<FormularioTarjeta importe="99.00" onToken={onToken} />);
  await waitFor(() => expect(sdk.listeners.size).toBe(3));
  await act(async () => { sdk.listeners.get("cardNumber")!.get("binChange")!({ bin: "41111111" }); });
  const boton = screen.getByRole("button", { name: "Pagar $99.00 MXN" });
  await waitFor(() => expect((boton as HTMLButtonElement).disabled).toBe(false));
  expect(screen.queryByLabelText(/documento/i)).toBeNull();
  expect(screen.queryByLabelText(/correo/i)).toBeNull();
  expect(view.container.querySelectorAll("form form")).toHaveLength(0);
  fireEvent.change(screen.getByLabelText("Titular"), { target: { value: "APRO" } });
  fireEvent.submit(boton.closest("form")!);
  fireEvent.submit(boton.closest("form")!);
  await waitFor(() => expect(onToken).toHaveBeenCalledTimes(1));
  expect(sdk.createCardToken).toHaveBeenCalledExactlyOnceWith({ cardholderName: "APRO" });
  expect(onToken.mock.calls[0]).toEqual([{ token: "token-efimero", paymentMethodId: "visa", paymentTypeId: "debit_card", installments: "1" }]);
  expect(sdk.getInstallments).not.toHaveBeenCalled();
  await act(async () => terminar());
  view.unmount();
  expect(sdk.unmount).toHaveBeenCalledTimes(3);
});

it("descarta consultas atrasadas del BIN y conserva las cuotas de la tarjeta vigente", async () => {
  const sdk = sdkSimulado();
  let anterior!: (data: { results: MetodoTarjeta[] }) => void;
  sdk.getPaymentMethods.mockImplementationOnce(() => new Promise(resolve => { anterior = resolve; }));
  sdk.getPaymentMethods.mockResolvedValue({ results: [{ id: "master", name: "Mastercard", payment_type_id: "credit_card" }] });
  const onToken = vi.fn(async () => {});
  render(<FormularioTarjeta importe="99.00" onToken={onToken} />);
  await waitFor(() => expect(sdk.listeners.size).toBe(3));
  await act(async () => { sdk.listeners.get("cardNumber")!.get("binChange")!({ bin: "41111111" }); });
  await act(async () => { sdk.listeners.get("cardNumber")!.get("binChange")!({ bin: "55555555" }); });
  const boton = screen.getByRole("button", { name: "Pagar $99.00 MXN" });
  await waitFor(() => expect((boton as HTMLButtonElement).disabled).toBe(false));
  await act(async () => anterior({ results: [{ id: "visa", name: "Visa", payment_type_id: "debit_card" }] }));
  expect(sdk.getInstallments).toHaveBeenCalledExactlyOnceWith({ amount: "99.00", bin: "55555555" });
  fireEvent.change(screen.getByLabelText("Titular"), { target: { value: "APRO" } });
  fireEvent.change(screen.getByLabelText("Cuotas"), { target: { value: "3" } });
  fireEvent.submit(boton.closest("form")!);
  await waitFor(() => expect(onToken).toHaveBeenCalledExactlyOnceWith({ token: "token-efimero", paymentMethodId: "master", paymentTypeId: "credit_card", installments: "3" }));
});
