// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { GoogleSignIn } from "./GoogleSignIn";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete window.google;
});

it("no carga Google cuando no se ha configurado su Client ID", () => {
  vi.stubEnv("PUBLIC_GOOGLE_CLIENT_ID", "");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const { container } = render(
    <GoogleSignIn next="/" disabled={false} onBusy={vi.fn()} />,
  );
  expect(container.textContent).toBe("");
  expect(fetch).not.toHaveBeenCalled();
});

it("usa el botón oficial con nonce y pide la contraseña antes de vincular una cuenta", async () => {
  vi.stubEnv("PUBLIC_GOOGLE_CLIENT_ID", "cliente-google");
  let callback!: (response: { credential: string }) => void;
  const initialize = vi.fn((options) => {
    callback = options.callback;
  });
  window.google = { accounts: { id: { initialize, renderButton: vi.fn() } } };
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ nonce: "nonce-servidor" }))
    .mockResolvedValueOnce(
      Response.json(
        { code: "GOOGLE_LINK_REQUIRED", error: "Confirma tu contraseña" },
        { status: 409 },
      ),
    )
    .mockResolvedValueOnce(
      Response.json({ error: "Inténtalo más tarde" }, { status: 503 }),
    );
  vi.stubGlobal("fetch", fetch);
  const busy = vi.fn();
  render(<GoogleSignIn next="/checkout" disabled={false} onBusy={busy} />);
  await waitFor(() => expect(initialize).toHaveBeenCalledOnce());
  expect(initialize.mock.calls[0][0]).toMatchObject({
    client_id: "cliente-google",
    nonce: "nonce-servidor",
    auto_select: false,
  });
  await act(async () => callback({ credential: "credencial-google" }));
  const password = await screen.findByLabelText(
    "Contraseña actual de TecnoLeague",
  );
  fireEvent.change(password, { target: { value: "password-cuenta" } });
  fireEvent.submit(password.closest("form")!);
  await screen.findByText("Inténtalo más tarde");
  expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({
    credential: "credencial-google",
    password: "password-cuenta",
  });
  expect(localStorage.getItem("credencial-google")).toBeNull();
  expect(busy).toHaveBeenCalledWith(true);
  expect(busy).toHaveBeenLastCalledWith(false);
});
