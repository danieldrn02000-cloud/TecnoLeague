//comprueba la distribucion de eventos sin arrancar postgreSQL, nestjs ni websocket
//esta prueba valida el servicio
import assert from "node:assert/strict";
import { test } from "node:test";
import {EventosService} from "../src/eventos.service";

test(
  "distribuye el mismo evento a dos suscriptores",
  { timeout: 3000 },
  async () => {
    const eventos = new EventosService();

    const primero = eventos.escucharBackOffice();
    const segundo = eventos.escucharBackOffice();

    try {
      // next() activa la escucha antes de publicar.
      const pendientePrimero = primero.next();
      const pendienteSegundo = segundo.next();

      await eventos.publicarBackOffice({
        entidad: "PEDIDO",
        entidadId: 42,
        accion: "CREADO",
      });

      const [resultadoPrimero, resultadoSegundo] =
        await Promise.all([
          pendientePrimero,
          pendienteSegundo,
        ]);

      assert.equal(resultadoPrimero.done, false);
      assert.equal(resultadoSegundo.done, false);

      const evento =
        resultadoPrimero.value.backOfficeActualizado;

      assert.equal(evento.entidad, "PEDIDO");
      assert.equal(evento.entidadId, 42);
      assert.equal(evento.accion, "CREADO");
      assert.ok(evento.eventoId);
      assert.ok(Number.isFinite(Date.parse(evento.ocurridoEn)));

      assert.deepEqual(
        resultadoSegundo.value,
        resultadoPrimero.value,
      );
    } finally {
      await Promise.all([
        primero.return?.(),
        segundo.return?.(),
      ]);
    }
  },
);