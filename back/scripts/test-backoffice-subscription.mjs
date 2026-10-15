import { loadEnvFile } from "node:process";
import { createClient } from "graphql-ws";
import WebSocket from "ws";

// Lee la configuración local sin imprimir sus valores.
loadEnvFile(
  new URL("../.env", import.meta.url),
);

const email =
  process.env.TEST_ADMIN_EMAIL || process.env.ADMIN_EMAIL;

const password =
  process.env.TEST_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;

const bridge = process.env.AUTH_BRIDGE_SECRET;

if (!email || !password || !bridge) {
  throw new Error(
    "Faltan las credenciales de prueba del administrador o AUTH_BRIDGE_SECRET.",
  );
}

// Autentica al administrador mediante el login existente.
const response = await fetch(
  "http://127.0.0.1:4000/graphql",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-auth-bridge-secret": bridge,
    },
    body: JSON.stringify({
      query: `
        mutation Login($datos: CredencialesInput!) {
          iniciarSesion(datos: $datos) {
            token
            usuario {
              rol
            }
          }
        }
      `,
      variables: {
        datos: { email, password },
      },
    }),
    signal: AbortSignal.timeout(15000),
  },
);

const body = await response.json();
const sesion = body.data?.iniciarSesion;

if (
  !response.ok ||
  body.errors?.length ||
  !sesion?.token
) {
  throw new Error(
    "No se pudo autenticar al administrador. Revisa sus credenciales y el backend.",
  );
}

if (sesion.usuario.rol !== "ADMIN") {
  throw new Error(
    "La cuenta de prueba no tiene rol ADMIN.",
  );
}

// Abre la conexión enviando el token obtenido.
const client = createClient({
  url: "ws://127.0.0.1:4000/graphql",
  webSocketImpl: WebSocket,
  retryAttempts: 0,
  connectionParams: {
    authorization: `Bearer ${sesion.token}`,
  },
  on: {
    connected: () => {
      console.log(
        "WebSocket conectado. Esperando eventos administrativos...",
      );
    },
  },
});

process.once("SIGINT", () => {
  void client.dispose();
});

try {
  for await (const resultado of client.iterate({
    query: `
      subscription {
        backOfficeActualizado {
          eventoId
          entidad
          entidadId
          accion
          ocurridoEn
        }
      }
    `,
  })) {
    if (resultado.errors?.length) {
      throw new Error(
        resultado.errors.map((error) => error.message).join("; "),
      );
    }

    console.log(JSON.stringify(resultado, null, 2));
  }
} finally {
  await client.dispose();
}