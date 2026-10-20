// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { obtenerMercadoPago } from "../lib/mercadoPago";
import { FormularioTarjeta } from "./tarjeta";
vi.mock("../lib/mercadoPago", () => ({ obtenerMercadoPago: vi.fn() }));
type Config = Parameters<Awaited<ReturnType<typeof obtenerMercadoPago>>["cardForm"]>[0];
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("monta campos seguros sin formularios anidados, identifica débito y bloquea doble envío", async () => {
  let config!: Config;
  let terminar!: () => void;
  const onToken = vi.fn(() => new Promise<void>(resolve => { terminar = resolve; }));
  const unmount = vi.fn();
  vi.mocked(obtenerMercadoPago).mockResolvedValue({ cardForm: c => {
    config = c;
    c.callbacks.onFormMounted();
    return { unmount, getCardFormData: () => ({ token: "token", paymentMethodId: "visa", installments: "1", issuerId: "1", cardholderEmail: "test@example.test", identificationType: "", identificationNumber: "" }) };
  } });
  const view = render(<FormularioTarjeta importe="99.00" onToken={onToken} />);
  await screen.findByRole("button", { name: "Pagar $99.00 MXN" });
  expect(view.container.querySelectorAll("form form")).toHaveLength(0);
  expect(config.iframe).toBe(true);
  expect(config.amount).toBe("99.00");
  await act(async () => {
    config.callbacks.onPaymentMethodsReceived?.(undefined, { results: [{ id: "visa", payment_type_id: "debit_card" }] });
    config.callbacks.onSubmit(new Event("submit"));
    config.callbacks.onSubmit(new Event("submit"));
  });
  expect(onToken).toHaveBeenCalledTimes(1);
  expect(onToken.mock.calls[0]).toEqual([{ token: "token", paymentMethodId: "visa", installments: "1", issuerId: "1", cardholderEmail: "test@example.test", identificationType: "", identificationNumber: "", paymentTypeId: "debit_card" }]);
  await act(async () => terminar());
  view.unmount();
  expect(unmount).toHaveBeenCalledTimes(1);
});
