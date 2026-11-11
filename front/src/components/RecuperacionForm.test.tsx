// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RecuperacionForm } from "./RecuperacionForm";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("solicita el código y muestra el paso de verificación sin revelar cuentas", async () => {
  const fetch = vi.fn(async (_url: RequestInfo | URL, _options?: RequestInit) => Response.json({ ok: true })); vi.stubGlobal("fetch", fetch);
  render(<RecuperacionForm modo="codigo" />);
  fireEvent.change(screen.getByLabelText("Correo electrónico"), { target: { value: "cliente@example.test" } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar código" }));
  await screen.findByLabelText("Código de seis dígitos");
  expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual({ accion: "solicitar", email: "cliente@example.test" });
  expect(screen.getByText(/Si hay una cuenta con ese correo/)).toBeTruthy();
  expect((screen.getByRole("button", { name: /Reenviar código en/ }) as HTMLButtonElement).disabled).toBe(true);
});
it("muestra un código incorrecto y mantiene el paso de verificación", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "El código es incorrecto o ya venció." }, { status: 400 })));
  render(<RecuperacionForm modo="codigo" codigoEnviado />);
  fireEvent.change(screen.getByLabelText("Código de seis dígitos"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Verificar código" }));
  await screen.findByRole("alert");
  expect(screen.queryByLabelText("Nueva contraseña")).toBeNull();
});
it("no envía contraseñas que no coinciden y permite corregirlas", async () => {
  const fetch = vi.fn(async (_url: RequestInfo | URL, _options?: RequestInit) => Response.json({ error: "La recuperación venció." }, { status: 400 })); vi.stubGlobal("fetch", fetch);
  render(<RecuperacionForm modo="password" />);
  fireEvent.change(screen.getByLabelText("Nueva contraseña"), { target: { value: "Nueva-1234" } });
  fireEvent.change(screen.getByLabelText("Confirmar nueva contraseña"), { target: { value: "Otra-1234" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar nueva contraseña" }));
  await screen.findByText("Las contraseñas no coinciden.");
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Confirmar nueva contraseña"), { target: { value: "Nueva-1234" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar nueva contraseña" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual({ accion: "restablecer", password: "Nueva-1234", confirmPassword: "Nueva-1234" });
});
