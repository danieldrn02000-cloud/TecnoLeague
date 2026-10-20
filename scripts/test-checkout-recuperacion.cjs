// Recuperación del helper real; los componentes se prueban en Checkout.test.tsx.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
class GraphQLError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}
function fixture() {
  const f = { local: null, active: null, error: null, activeError: null, states: new Map(), forgotten: [], confirmed: [], calls: [] };
  const source = fs.readFileSync(path.join(__dirname, "../front/src/lib/verificar-checkout.ts"), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exported = {};
  const modules = {
    "../api": {
      GraphQLError,
      graphql: async (query, vars) => {
        f.calls.push(query);
        if (query === "{intentoActivo}") {
          if (f.activeError) throw f.activeError;
          return { intentoActivo: f.active };
        }
        assert.equal(query, "consulta-estado");
        if (f.error) throw f.error;
        const estado = f.states.get(vars.id);
        if (!estado) throw new GraphQLError("No encontrado", "NOT_FOUND");
        return { estadoIntento: estado };
      },
    },
    "./checkout": {
      CONSULTAR_INTENTO: "consulta-estado",
      leerIntento: () => f.local,
      guardarIntento: (_, id) => { f.local = id; },
      olvidarIntento: (_, id) => { f.forgotten.push(id); if (f.local === id) f.local = null; },
      aplicarCompraConfirmada: async (_, estado) => { f.confirmed.push(estado.intentoId); },
    },
  };
  vm.runInNewContext(js, { exports: exported, require: name => {
    assert.ok(name in modules, `Import conocido ${name}`); return modules[name];
  } });
  f.verify = () => exported.verificarCheckout(7);
  return f;
}
const estado = (id, value = "EN_PROCESO") => ({ intentoId: id, estado: value, pedidoId: value === "CONFIRMADO" ? 42 : null, aviso: null });

test("sin referencia consulta intentos activos", async () => {
  const f = fixture(); const r = await f.verify();
  assert.equal(r.pendiente, null); assert.equal(r.estado, null);
  assert.deepEqual(f.calls, ["{intentoActivo}"]);
});
test("referencia inexistente se olvida y no oculta un intento de otro dispositivo", async () => {
  const f = fixture(); f.local = "obsoleto"; f.active = "vigente";
  f.states.set("vigente", estado("vigente"));
  const r = await f.verify();
  assert.equal(r.pendiente, "vigente"); assert.equal(f.local, "vigente");
  assert.ok(f.forgotten.includes("obsoleto"));
});
test("un fallo de red no se interpreta como intento inexistente", async () => {
  const f = fixture(); f.local = "incierto"; f.error = new Error("Timeout");
  await assert.rejects(f.verify(), /Timeout/);
  assert.equal(f.local, "incierto"); assert.equal(f.forgotten.length, 0);
});
test("un fallo al buscar intentos activos impide declarar libre el checkout", async () => {
  const f = fixture(); f.activeError = new Error("Sin conexión");
  await assert.rejects(f.verify(), /Sin conexión/);
});
for (const value of ["RECHAZADO", "CANCELADO", "EXPIRADO"]) {
  test(`${value} conserva su resultado y libera la referencia local`, async () => {
    const f = fixture(); f.local = "terminado"; f.states.set("terminado", estado("terminado", value));
    const r = await f.verify();
    assert.equal(r.pendiente, null); assert.equal(r.estado.estado, value); assert.equal(f.local, null);
    assert.equal(f.confirmed.length, 0);
  });
}
test("confirmación aplica el carrito y devuelve el pedido", async () => {
  const f = fixture(); f.local = "pagado"; f.states.set("pagado", estado("pagado", "CONFIRMADO"));
  const r = await f.verify();
  assert.equal(r.estado.pedidoId, 42); assert.equal(f.local, null);
  assert.deepEqual(f.confirmed, ["pagado"]);
});
test("la reserva sin operación puede recuperarse para continuar el formulario", async () => {
  const f = fixture(); f.local = "reserva";
  f.states.set("reserva", { ...estado("reserva", "INICIADO"), modalidad: "ORDERS_API", operacionId: null, total: "99.00" });
  const r = await f.verify();
  assert.equal(r.pendiente, "reserva"); assert.equal(r.estado.operacionId, null); assert.equal(r.estado.total, "99.00");
});
