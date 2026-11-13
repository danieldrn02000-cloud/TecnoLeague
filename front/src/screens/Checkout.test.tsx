// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { EstadoCheckout } from "../lib/checkout";
import {
  CONSULTAR_INTENTO,
  PREPARAR_COMPRA,
  PROCESAR_PAGO,
  INICIAR_PAYPAL,
  guardarIntento,
} from "../lib/checkout";
import { graphql, GraphQLError } from "../api";
import { Checkout } from "./Checkout";
import { abrirPayPal } from "../lib/paypal";
vi.mock("../lib/paypal", async original => ({ ...await original<typeof import("../lib/paypal")>(), abrirPayPal: vi.fn() }));

vi.mock("../api", async (original) => ({
  ...(await original<typeof import("../api")>()),
  graphql: vi.fn(),
}));
vi.mock("../store", () => ({
  useCarrito: () => ({
    lineas: [
      {
        producto: { id: 1, nombre: "Teclado", precio: 10, stock: 5 },
        cantidad: 2,
      },
    ],
    total: 20,
    unidades: 2,
  }),
}));
vi.mock("../components/tarjeta", () => ({
  FormularioTarjeta: ({
    importe,
    procesando,
    onToken,
  }: {
    importe: string;
    procesando: boolean;
    onToken: (p: unknown) => Promise<void>;
  }) => (
    <button
      type="button"
      disabled={procesando}
      onClick={() =>
        void onToken({
          token: "token-efimero",
          paymentMethodId: "visa",
          paymentTypeId: "debit_card",
          installments: "1",
          cardholderEmail: "otro@example.test",
          identificationType: "",
          identificationNumber: "",
        })
      }
    >
      Pagar {importe}
    </button>
  ),
}));

const usuario = {
  id: 7,
  nombre: "Comprador",
  email: "comprador@example.test",
  rol: "CLIENTE" as const,
};
let estados: Map<string, EstadoCheckout>;
let procesar: (id: string) => Promise<EstadoCheckout>;
const api = vi.mocked(graphql);
function estado(
  id: string,
  extra: Partial<EstadoCheckout> = {},
): EstadoCheckout {
  return {
    intentoId: id,
    estado: "INICIADO",
    total: "99.00",
    moneda: "MXN",
    pedidoId: null,
    modalidad: "ORDERS_API",
    operacionId: null,
    estadoOperacion: null,
    autenticacion: null,
    aviso: null,
    checkoutUrl: null,
    expiraEn: new Date(Date.now() + 900_000).toISOString(),
    renglones: [{ productoId: 1, cantidad: 1 }],
    ...extra,
  };
}
function abrir() {
  return render(
    <Checkout currentUser={usuario} navegar={vi.fn()} completado={vi.fn()} />,
  );
}
async function preparar() {
  fireEvent.click(screen.getByLabelText("Tarjeta con Mercado Pago"));
  const boton = await screen.findByRole("button", {
    name: /Continuar al pago/,
  });
  await waitFor(() =>
    expect((boton as HTMLButtonElement).disabled).toBe(false),
  );
  fireEvent.submit(boton.closest("form")!);
  await screen.findByRole("button", { name: "Pagar 99.00" });
}

beforeEach(() => {
  vi.stubEnv("PUBLIC_MP_PUBLIC_KEY", "TEST-checkout");
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem(
    "tl-carrito-v1",
    JSON.stringify([{ producto: { id: 1 }, cantidad: 2 }]),
  );
  estados = new Map();
  procesar = async (id) =>
    estado(id, {
      estado: "CONFIRMADO",
      pedidoId: 42,
      operacionId: "op",
      estadoOperacion: "FINALIZADA",
    });
  api.mockImplementation(async (query, variables = {}) => {
    if (query === "{intentoActivo}") return { intentoActivo: null };
    if (query === CONSULTAR_INTENTO) {
      const actual = estados.get(String(variables.id));
      if (!actual) throw new GraphQLError("Intento no encontrado", "NOT_FOUND");
      return { estadoIntento: actual };
    }
    if (query === PREPARAR_COMPRA) {
      const datos = variables.datos as { claveSolicitud: string };
      const nuevo = estado(datos.claveSolicitud);
      estados.set(nuevo.intentoId, nuevo);
      return { prepararCompra: nuevo };
    }
    if (query === INICIAR_PAYPAL) {
      const datos = variables.datos as { claveSolicitud: string };
      const nuevo = estado(datos.claveSolicitud, { modalidad: "PAYPAL", estado: "EN_PROCESO", operacionId: "op-paypal",
        estadoOperacion: "VINCULADA", checkoutUrl: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER123" });
      estados.set(nuevo.intentoId, nuevo);
      return { iniciarPagoPayPal: nuevo };
    }
    if (query === PROCESAR_PAGO) {
      const nuevo = await procesar(String(variables.id));
      estados.set(nuevo.intentoId, nuevo);
      return { procesarPago: nuevo };
    }
    throw new Error(`Consulta inesperada: ${query}`);
  });
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe("Checkout dentro del sitio", () => {
  it("PayPal redirige y conserva la referencia, sin tokenizar ni enviar importes del navegador", async () => {
    abrir();
    const boton = await screen.findByRole("button", { name: /Continuar con PayPal/ });
    await waitFor(() => expect((boton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.submit(boton.closest("form")!);
    await waitFor(() => expect(abrirPayPal).toHaveBeenCalledWith("https://www.sandbox.paypal.com/checkoutnow?token=ORDER123"));
    expect(api.mock.calls.some(([q]) => q === PROCESAR_PAGO || q === PREPARAR_COMPRA)).toBe(false);
    const llamada = api.mock.calls.find(([q]) => q === INICIAR_PAYPAL)!;
    expect(llamada[1]?.datos).not.toHaveProperty("total");
    expect(localStorage.getItem(`tl-checkout-${usuario.id}`)).toBeTruthy();
  });
  it("permite PayPal sin configurar las claves de Mercado Pago", async () => {
    vi.stubEnv("PUBLIC_MP_PUBLIC_KEY", ""); abrir();
    const boton = await screen.findByRole("button", { name: /Continuar con PayPal/ });
    await waitFor(() => expect((boton as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByLabelText("Tarjeta con Mercado Pago")).toBeNull();
  });
  it("distingue una solicitud inválida de un rechazo bancario", async () => {
    procesar = async id => estado(id, {
      estado: "RECHAZADO", solicitudRechazada: true, operacionId: "op", estadoOperacion: "FINALIZADA",
      aviso: "No se pudo iniciar el pago. Mercado Pago respondió HTTP 400.",
    });
    abrir(); await preparar();
    fireEvent.click(screen.getByRole("button", { name: "Pagar 99.00" }));
    await screen.findByRole("heading", { name: "No se pudo iniciar el pago" });
    expect(
      screen.queryByRole("heading", { name: "Pago rechazado" }),
    ).toBeNull();
    expect(JSON.parse(localStorage.getItem("tl-carrito-v1")!)[0].cantidad).toBe(
      2,
    );
  });
  it("prepara antes de tokenizar y utiliza el total del servidor", async () => {
    const url = window.location.href;
    abrir();
    expect(screen.queryByLabelText(/Correo electrónico/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /Pagar 99/ })).toBeNull();
    await preparar();
    expect(api.mock.calls.filter(([q]) => q === PREPARAR_COMPRA)).toHaveLength(
      1,
    );
    const preparacion = api.mock.calls.find(([q]) => q === PREPARAR_COMPRA)!;
    expect(preparacion[1]?.datos).toMatchObject({ email: usuario.email });
    expect(api.mock.calls.some(([q]) => q === PROCESAR_PAGO)).toBe(false);
    expect(window.location.href).toBe(url);
    expect(screen.getAllByText(/Total:/)[0].textContent).toContain(
      "99.00",
    );
  });

  it("envía el tipo de tarjeta, confirma en pantalla y ajusta el carrito una sola vez", async () => {
    abrir();
    await preparar();
    fireEvent.click(screen.getByRole("button", { name: "Pagar 99.00" }));
    await screen.findByRole("heading", { name: "Pago aprobado" });
    expect(screen.getByText("Tu pedido #42 está pagado.")).toBeTruthy();
    const llamada = api.mock.calls.find(([q]) => q === PROCESAR_PAGO)!;
    expect(llamada[1]?.pago).toMatchObject({
      tipoMetodoPago: "debit_card",
      cuotas: 1,
      email: usuario.email,
    });
    expect(llamada[1]?.pago).not.toHaveProperty("total");
    expect(llamada[1]?.pago).not.toHaveProperty("identificacion");
    expect(JSON.parse(localStorage.getItem("tl-carrito-v1")!)[0].cantidad).toBe(
      1,
    );
    expect(JSON.stringify(localStorage)).not.toContain("token-efimero");
    const id = String(llamada[1]?.id);
    cleanup();
    guardarIntento(usuario.id, id);
    abrir();
    await screen.findByRole("heading", { name: "Pago aprobado" });
    expect(JSON.parse(localStorage.getItem("tl-carrito-v1")!)[0].cantidad).toBe(
      1,
    );
    expect(api.mock.calls.filter(([q]) => q === PROCESAR_PAGO)).toHaveLength(1);
  });

  it("recupera una reserva sin cobro y permite continuar con la tarjeta", async () => {
    estados.set("reserva", estado("reserva"));
    guardarIntento(usuario.id, "reserva");
    abrir();
    await screen.findByRole("button", { name: "Pagar 99.00" });
    expect(api.mock.calls.some(([q]) => q === PREPARAR_COMPRA)).toBe(false);
  });

  it("un timeout consulta el mismo intento y bloquea nuevos cobros", async () => {
    procesar = async (id) => {
      estados.set(
        id,
        estado(id, {
          estado: "EN_PROCESO",
          operacionId: "op",
          estadoOperacion: "INCIERTA",
        }),
      );
      throw new Error("Timeout");
    };
    abrir();
    await preparar();
    fireEvent.click(screen.getByRole("button", { name: "Pagar 99.00" }));
    await screen.findByText(/Todavía no pudimos confirmar tu pago/);
    await screen.findByRole("heading", { name: "Estamos verificando tu pago" });
    window.dispatchEvent(new Event("pagehide"));
    expect(sessionStorage.getItem("tl-pantalla-pendiente")).toBe("checkout");
    expect(screen.queryByRole("button", { name: "Pagar 99.00" })).toBeNull();
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Consultar estado",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Consultar estado" }));
    expect(api.mock.calls.filter(([q]) => q === PROCESAR_PAGO)).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem("tl-carrito-v1")!)[0].cantidad).toBe(
      2,
    );
  });

  it("el rechazo conserva carrito y permite preparar otra compra", async () => {
    procesar = async (id) =>
      estado(id, {
        estado: "RECHAZADO",
        operacionId: "op",
        estadoOperacion: "FINALIZADA",
      });
    abrir();
    await preparar();
    fireEvent.click(screen.getByRole("button", { name: "Pagar 99.00" }));
    await screen.findByRole("heading", { name: "Pago rechazado" });
    expect(JSON.parse(localStorage.getItem("tl-carrito-v1")!)[0].cantidad).toBe(
      2,
    );
    fireEvent.click(screen.getByRole("button", { name: "Volver a intentar" }));
    await screen.findByRole("button", { name: /Continuar (al pago|con PayPal)/ });
  });

  it("muestra 3DS y solo confirma tras consultar el backend", async () => {
    procesar = async (id) =>
      estado(id, {
        estado: "EN_PROCESO",
        operacionId: "op",
        estadoOperacion: "VINCULADA",
        autenticacion: { url: "https://banco.example.test/challenge" },
      });
    abrir();
    await preparar();
    fireEvent.click(screen.getByRole("button", { name: "Pagar 99.00" }));
    await screen.findByTitle("Autenticación bancaria del pago");
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { estado: "approved" },
        origin: "https://banco.example.test",
      }),
    );
    expect(screen.queryByRole("heading", { name: "Pago aprobado" })).toBeNull();
    expect(JSON.parse(localStorage.getItem("tl-carrito-v1")!)[0].cantidad).toBe(
      2,
    );
    const id = api.mock.calls.find(([q]) => q === PROCESAR_PAGO)![1]!
      .id as string;
    estados.set(
      id,
      estado(id, {
        estado: "CONFIRMADO",
        pedidoId: 42,
        operacionId: "op",
        estadoOperacion: "FINALIZADA",
      }),
    );
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Consultar estado",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Consultar estado" }));
    await screen.findByRole("heading", { name: "Pago aprobado" });
    expect(screen.queryByTitle("Autenticación bancaria del pago")).toBeNull();
  });
});
