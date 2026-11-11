// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AuthForm } from "./AuthForm";
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });
it("recuerda solo el correo y lo elimina al desmarcar la casilla", () => {
  localStorage.setItem("tl_email_recordado", "recordado@example.test");
  render(<AuthForm mode="login" next="/" />);
  expect((screen.getByLabelText("Correo electrónico") as HTMLInputElement).value).toBe("recordado@example.test");
  expect((screen.getByLabelText("Contraseña") as HTMLInputElement).value).toBe("");
  const checkbox = screen.getByLabelText("Recordar mi correo") as HTMLInputElement;
  expect(checkbox.checked).toBe(true);
  fireEvent.click(checkbox);
  expect(localStorage.getItem("tl_email_recordado")).toBeNull();
});
it("el enlace de recuperación no envía el formulario de acceso", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Espera un minuto." }, { status: 429 })));
  render(<AuthForm mode="login" next="/" />);
  fireEvent.change(screen.getByLabelText("Correo electrónico"), { target: { value: "cliente@example.test" } });
  const boton = screen.getByRole("button", { name: "¿Olvidaste tu contraseña?" }) as HTMLButtonElement;
  expect(boton.type).toBe("button");
  fireEvent.click(boton);
  await screen.findByText("Espera un minuto.");
  expect(fetch).toHaveBeenCalledWith("/api/auth/recuperacion", expect.anything());
});
it("permite mostrar el acceso aunque localStorage esté bloqueado", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Bloqueado"); });
  render(<AuthForm mode="login" next="/" />);
  expect(screen.getByRole("button", { name: "Iniciar sesión" })).toBeTruthy();
});
