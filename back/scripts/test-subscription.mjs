import assert from "node:assert/strict";
import { createClient } from "graphql-ws";
import WebSocket from "ws";

const client = createClient({
  url: "ws://127.0.0.1:4000/graphql",
  webSocketImpl: WebSocket,
  retryAttempts: 0,
});

const timeout = setTimeout(() => {
  console.error("No llegó el evento dentro de 10 segundos.");
  process.exit(1);
}, 10_000);

try {
  let recibidos = 0;

  for await (const resultado of client.iterate({
    query: "subscription { pruebaConexion }",
  })) {
    assert.equal(resultado.errors, undefined);
    assert.equal(
      resultado.data?.pruebaConexion,
      "Subscriptions funcionando",
    );
    recibidos++;
  }

  assert.equal(recibidos, 1);
  console.log("OK: conexión WebSocket y subscription verificadas.");
} finally {
  clearTimeout(timeout);
  await client.dispose();
}