import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  expect,
  it,
  vi,
} from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { ViteDevServer } from "vite";
import WebSocket from "ws";
import { JSDOM } from "jsdom";
import "reflect-metadata";
import { useBackOfficeEvents } from "../src/hooks/useBackOfficeEvents";
import { emitirTicketBackOffice } from "../src/pages/api/admin/subscription-ticket";

const require = createRequire(import.meta.url);
const { createServer } = require("vite") as typeof import("vite");
require("reflect-metadata");
require("dotenv").config({
  path: resolve(process.cwd(), "../back/.env"),
  quiet: true,
});
process.env.MP_RECONCILIATION_DISABLED = "1";
const { Module } = require("@nestjs/common");
const { NestFactory } = require("@nestjs/core");
const { GraphQLModule } = require("@nestjs/graphql");
const { JwtService } = require("@nestjs/jwt");
const { AppModule } = require("../../back/dist/app.module");
const { PrismaService } = require("../../back/dist/prisma.service");
const { EventosService } = require("../../back/dist/eventos.service");
const { Prisma } = require("@prisma/client");

let app: any;
let dom: JSDOM;
let proxy: ViteDevServer;
let token = "";
let adminToken = "";
let clientToken = "";
let origin = "";
let ticketDelay = 0;
let ticketReady = false;
let openedBeforeTicket = false;
let ticketRequests = 0;
let socketCount = 0;
const sockets = new Set<WebSocket>();
const nativeFetch = globalThis.fetch;
const requestIds: string[] = [];

beforeAll(async () => {
  dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost:5173",
  });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("navigator", dom.window.navigator);
  vi.stubGlobal("Event", dom.window.Event);
  vi.stubGlobal("CustomEvent", dom.window.CustomEvent);
  const database = new URL(process.env.DATABASE_URL || "");
  if (!["127.0.0.1", "localhost"].includes(database.hostname))
    throw new Error(
      "Usa una base PostgreSQL LOCAL de desarrollo migrada y con seed para esta prueba.",
    );
  // Misma configuración, resolvers, guards, JWT y Prisma que la aplicación.
  // Solo se acorta el plazo del connection_init para reproducir el fallo.
  const imports = Reflect.getMetadata("imports", AppModule);
  const options = imports[0].providers.find(
    (p: any) => p.provide === "GqlModuleOptions",
  ).useValue;
  class TestApp {}
  Module({
    imports: [
      GraphQLModule.forRoot({
        ...options,
        subscriptions: {
          "graphql-ws": {
            ...options.subscriptions["graphql-ws"],
            connectionInitWaitTimeout: 1000,
          },
        },
      }),
      ...imports.slice(1),
    ],
    providers: Reflect.getMetadata("providers", AppModule),
    controllers: Reflect.getMetadata("controllers", AppModule),
  })(TestApp);
  app = await NestFactory.create(TestApp, { logger: false });
  await app.listen(0, "127.0.0.1");
  const backend = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  vi.stubEnv("BACKEND_GRAPHQL_URL", `${backend}/graphql`);
  const db = app.get(PrismaService);
  const admin = await db.usuario.findUniqueOrThrow({
    where: { email: process.env.ADMIN_EMAIL },
  });
  const client = await db.usuario.findFirstOrThrow({
    where: { rol: "CLIENTE" },
  });
  adminToken = app.get(JwtService).sign({ sub: admin.id }, { expiresIn: "5m" });
  clientToken = app
    .get(JwtService)
    .sign({ sub: client.id }, { expiresIn: "5m" });
  proxy = await createServer({
    configFile: false,
    server: {
      host: "127.0.0.1",
      port: 0,
      proxy: {
        "/api/backoffice-ws": {
          target: backend,
          ws: true,
          changeOrigin: true,
          rewrite: () => "/graphql",
        },
      },
    },
    appType: "custom",
  });
  proxy.middlewares.use("/api/admin/subscription-ticket", async (req, res) => {
    try {
      ticketRequests += 1;
      ticketReady = false;
      if (ticketDelay)
        await new Promise((resolve) => setTimeout(resolve, ticketDelay));
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers))
        if (typeof value === "string") headers.set(name, value);
      const request = new Request(`${origin}/api/admin/subscription-ticket`, {
        method: "POST",
        headers,
        body: new Uint8Array(Buffer.concat(chunks)),
      });
      const cookie = headers
        .get("cookie")
        ?.match(/(?:^|;\s*)tl_session=([^;]+)/)?.[1];
      const response = await emitirTicketBackOffice(request, {
        get: () => (cookie ? { value: cookie } : undefined),
        delete() {},
      });
      ticketReady = response.ok;
      requestIds.push(response.headers.get("x-backoffice-request-id") || "");
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.statusCode = 500;
      res.end("Error en el adaptador de prueba");
    }
  });
  await proxy.listen();
  const address = proxy.httpServer!.address() as { port: number };
  origin = `http://127.0.0.1:${address.port}`;
  vi.stubEnv(
    "PUBLIC_BACKOFFICE_WS_URL",
    origin.replace("http:", "ws:") + "/api/backoffice-ws",
  );
  vi.stubEnv("DEV", true);
  class BrowserSocket extends WebSocket {
    constructor(url: string, protocols?: string | string[]) {
      openedBeforeTicket ||= !ticketReady;
      socketCount += 1;
      super(url, protocols);
      sockets.add(this);
      this.once("close", () => sockets.delete(this));
    }
  }
  vi.stubGlobal("WebSocket", BrowserSocket);
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === "string" && input.startsWith("/")) {
      const headers = new Headers(init?.headers);
      headers.set("Origin", origin);
      if (token) headers.set("Cookie", `tl_session=${token}`);
      return nativeFetch(new URL(input, origin), { ...init, headers });
    }
    return nativeFetch(input, init);
  });
});

beforeEach(() => {
  token = adminToken;
  ticketDelay = 0;
  ticketReady = false;
  openedBeforeTicket = false;
  ticketRequests = 0;
  socketCount = 0;
  requestIds.length = 0;
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(async () => {
  cleanup();
  await waitFor(() => expect(sockets.size).toBe(0));
  vi.restoreAllMocks();
});
afterAll(async () => {
  for (const socket of sockets) socket.terminate();
  await proxy?.close();
  await app?.close();
  dom?.window.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("un ticket lento no abre un socket prematuro; recibe eventos reales y reconecta con un ticket nuevo", async () => {
  ticketDelay = 1200; // Supera el límite de 1000 ms del servidor WebSocket de prueba.
  const refresh = vi.fn();
  const reconnect = vi.fn();
  window.addEventListener("tl-backoffice-refresh", refresh);
  window.addEventListener("tl-backoffice-reconnected", reconnect);
  const { result, unmount } = renderHook(() => useBackOfficeEvents(vi.fn()));
  try {
    await waitFor(() => expect(result.current.estado).toBe("connected"), {
      timeout: 8000,
    });
    expect(openedBeforeTicket).toBe(false);
    expect(socketCount).toBe(1);
    const timer = setInterval(
      () =>
        void app.get(EventosService).publicarBackOffice({
          entidad: "PRODUCTO",
          entidadId: 0,
          accion: "ACTUALIZADO",
        }),
      100,
    );
    try {
      await waitFor(() => expect(refresh).toHaveBeenCalled(), {
        timeout: 4000,
      });
    } finally {
      clearInterval(timer);
    }
    act(() => {
      for (const socket of sockets) socket.terminate();
    });
    await waitFor(() => expect(ticketRequests).toBe(2), { timeout: 6000 });
    await waitFor(() => expect(reconnect).toHaveBeenCalledOnce(), {
      timeout: 8000,
    });
    expect(result.current.estado).toBe("connected");
    expect(openedBeforeTicket).toBe(false);
    expect(new Set(requestIds).size).toBe(2);
    unmount();
    await waitFor(() => expect(sockets.size).toBe(0));
  } finally {
    window.removeEventListener("tl-backoffice-refresh", refresh);
    window.removeEventListener("tl-backoffice-reconnected", reconnect);
  }
});

it.each([
  ["sin sesión", ""],
  ["con rol CLIENTE", "client"],
])("rechaza %s antes de abrir el socket", async (_name, session) => {
  token = session ? clientToken : "";
  const { result } = renderHook(() => useBackOfficeEvents(vi.fn()));
  await waitFor(() => expect(result.current.estado).toBe("denied"), {
    timeout: 4000,
  });
  expect(socketCount).toBe(0);
  expect(ticketRequests).toBe(1);
});

it("un error de Prisma se distingue de una sesión inválida sin filtrar credenciales", async () => {
  const db = app.get(PrismaService);
  vi.spyOn(db.usuario, "findUnique").mockRejectedValue(
    new Prisma.PrismaClientKnownRequestError(
      "postgresql://usuario:CLAVE_PRIVADA@servidor/base",
      { code: "P2024", clientVersion: "6.19.3" },
    ),
  );
  const response = await fetch("/api/admin/subscription-ticket", {
    method: "POST",
    body: "{}",
    headers: { "Content-Type": "application/json" },
  });
  expect(response.status).toBe(503);
  const body = await response.json();
  expect(body.code).toBe("DATABASE_UNAVAILABLE");
  expect(body.requestId).toBeTruthy();
  expect(JSON.stringify(body)).not.toContain("CLAVE_PRIVADA");
});
