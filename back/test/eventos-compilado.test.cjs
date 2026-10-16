const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventosService } = require("../dist/eventos.service");
//esta prueba unitaria comprueba que dos suscriptores reciben la misma publicacion
test(
  "PubSub entrega el mismo evento a dos oyentes y libera suscripciones",
  { timeout: 3000 },
  async () => {
    const eventos = new EventosService();
    const uno = eventos.escucharBackOffice(),
      dos = eventos.escucharBackOffice();
    try {
      const a = uno.next(),
        b = dos.next();
      await eventos.publicarBackOffice({
        entidad: "PEDIDO",
        entidadId: 42,
        accion: "CREADO",
      });
      const [primero, segundo] = await Promise.all([a, b]);
      assert.equal(primero.done, false);
      assert.deepEqual(primero, segundo);
      assert.equal(primero.value.backOfficeActualizado.entidadId, 42);
      assert.ok(primero.value.backOfficeActualizado.eventoId);
    } finally {
      await uno.return();
      await dos.return();
    }
  },
);
