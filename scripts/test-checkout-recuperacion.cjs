// Regresiones del bloqueo: ejecuta el helper y el componente reales con API simulada.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
class GraphQLError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}
const QUERY = "consulta-estado";
const estado = (id, value = "EN_PROCESO") => ({
  intentoId: id,
  estado: value,
  pedidoId: value === "CONFIRMADO" ? 123 : null,
  aviso: null,
  checkoutUrl: "https://www.mercadopago.com.mx/test",
  renglones: [],
  expiraEn: new Date().toISOString(),
});
function load(file, modules, extra = {}) {
  const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exported = {};
  vm.runInNewContext(js, {
    exports: exported,
    require: (name) => {
      assert.ok(name in modules, `Import conocido: ${name}`);
      return modules[name];
    },
    Error,
    ...extra,
  });
  return exported;
}
function fixture() {
  const f = {
    local: null,
    active: null,
    activeError: null,
    statusError: null,
    mutationError: null,
    states: new Map(),
    forgotten: [],
    confirmed: [],
    calls: [],
    redirect: null,
  };
  const checkout = {
    CONSULTAR_INTENTO: QUERY,
    leerIntento: () => f.local,
    guardarIntento: (_, id) => {
      f.local = id;
    },
    olvidarIntento: (_, id) => {
      f.forgotten.push(id);
      if (f.local === id) f.local = null;
    },
    aplicarCompraConfirmada: async (_, compra) => {
      f.confirmed.push(compra.intentoId);
      f.local = null;
    },
  };
  const graphql = async (query, variables) => {
    f.calls.push({ query, variables });
    if (query === "{intentoActivo}") {
      if (f.activeError) throw f.activeError;
      return { intentoActivo: f.active };
    }
    if (query === QUERY) {
      if (f.statusError) throw f.statusError;
      if (!f.states.has(variables.id))
        throw new GraphQLError("Intento no encontrado.", "NOT_FOUND");
      return { estadoIntento: f.states.get(variables.id) };
    }
    assert.ok(query.includes("iniciarPago"));
    if (typeof f.mutationError === "function")
      return f.mutationError(variables);
    if (f.mutationError) throw f.mutationError;
    return {
      iniciarPago: {
        intentoId: variables.datos.claveSolicitud,
        checkoutUrl: "https://www.mercadopago.com.mx/test",
        estado: "EN_PROCESO",
        pedidoId: null,
      },
    };
  };
  const api = { graphql, GraphQLError };
  const helper = load("front/src/lib/verificar-checkout.ts", {
    "../api": api,
    "./checkout": checkout,
  });
  f.verify = () => helper.verificarCheckout(1);
  const slots = [],
    effects = [];
  let cursor = 0;
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [
        slots[i],
        (v) => (slots[i] = typeof v === "function" ? v(slots[i]) : v),
      ];
    },
    useRef(initial) {
      const i = cursor++;
      return slots[i] ?? (slots[i] = { current: initial });
    },
    useEffect(fn, deps) {
      const i = cursor++;
      const old = slots[i];
      if (!old || deps.some((d, j) => d !== old.deps[j])) {
        if (old?.cleanup) old.cleanup();
        const slot = { deps };
        slots[i] = slot;
        effects.push(() => {
          slot.cleanup = fn();
        });
      }
    },
  };
  const jsx = (type, props) => ({ type, props });
  const component = load(
    "front/src/screens/Checkout.tsx",
    {
      react,
      "react/jsx-runtime": { jsx, jsxs: jsx },
      "lucide-react": {},
      "../api": api,
      "../store": {
        useCarrito: () => ({ lineas: [{ producto: { id: 1 }, cantidad: 1 }] }),
      },
      "./Carrito": { Resumen: "Resumen" },
      "../components/ui": { Vacio: "Vacio" },
      "../lib/checkout": checkout,
      "../lib/verificar-checkout": helper,
    },
    {
      crypto: { randomUUID: () => "00000000-0000-4000-8000-000000000001" },
      FormData: class {
        get(key) {
          return {
            nombre: "Comprador de prueba",
            email: "prueba@example.test",
            direccion: "Domicilio ficticio 123",
          }[key];
        }
      },
      window: {
        location: {
          assign: (url) => {
            f.redirect = url;
          },
        },
      },
    },
  );
  f.render = () => {
    cursor = 0;
    return component.Checkout({
      currentUser: { id: 1, nombre: "Prueba", email: "prueba@example.test" },
      navegar() {},
    });
  };
  f.settle = async () => {
    let tree;
    for (let i = 0; i < 5; i++) {
      tree = f.render();
      while (effects.length) effects.shift()();
      await new Promise((resolve) => setImmediate(resolve));
    }
    return tree;
  };
  f.find = (predicate) => {
    function walk(node) {
      if (!node || typeof node !== "object") return null;
      if (predicate(node)) return node;
      const children = node.props?.children;
      for (const child of Array.isArray(children) ? children : [children]) {
        const found = walk(child);
        if (found) return found;
      }
      return null;
    }
    return walk(f.render());
  };
  f.payButton = () =>
    f.find((n) => n.type === "button" && n.props.type === "submit");
  return f;
}

test("sin intentos permite pagar después de consultar al backend", async () => {
  const f = fixture();
  await f.settle();
  assert.equal(f.payButton().props.disabled, false);
});
test("fallo inicial termina la espera, muestra el error y permite reintentar sin abrir otro pago", async () => {
  const f = fixture();
  f.activeError = new Error("Render no disponible");
  await f.settle();
  assert.equal(f.payButton().props.disabled, true);
  assert.ok(JSON.stringify(f.render()).includes("Render no disponible"));
  const retry = f.find(
    (n) =>
      n.type === "button" && n.props.children === "Reintentar comprobación",
  );
  assert.ok(retry);
  f.activeError = null;
  retry.props.onClick();
  await f.settle();
  assert.equal(f.payButton().props.disabled, false);
});
test("ID local inexistente se verifica y elimina antes de habilitar una compra nueva", async () => {
  const f = fixture();
  f.local = "fantasma";
  await f.settle();
  assert.equal(f.local, null);
  assert.equal(f.payButton().props.disabled, false);
  assert.ok(f.forgotten.includes("fantasma"));
});
for (const value of ["RECHAZADO", "CANCELADO", "EXPIRADO"])
  test(`intento ${value} no bloquea permanentemente`, async () => {
    const f = fixture();
    f.local = "terminado";
    f.states.set("terminado", estado("terminado", value));
    await f.settle();
    assert.equal(f.local, null);
    assert.equal(f.payButton().props.disabled, false);
  });
test("un intento confirmado ajusta el carrito antes de liberar el checkout", async () => {
  const f = fixture();
  f.local = "pagado";
  f.states.set("pagado", estado("pagado", "CONFIRMADO"));
  await f.settle();
  assert.deepEqual(f.confirmed, ["pagado"]);
  assert.equal(f.local, null);
  assert.equal(f.payButton().props.disabled, false);
});
test("un intento realmente pendiente conserva la protección y ofrece su resultado", async () => {
  const f = fixture();
  f.local = "activo";
  f.states.set("activo", estado("activo"));
  await f.settle();
  assert.equal(f.local, "activo");
  assert.equal(f.payButton().props.disabled, true);
  assert.ok(
    f.find(
      (n) => n.type === "a" && n.props.href === "/pago/retorno?intento=activo",
    ),
  );
});
test("fallo de red al consultar ID local no lo borra ni habilita otro pago", async () => {
  const f = fixture();
  f.local = "incierto";
  f.statusError = new Error("Timeout");
  await f.settle();
  assert.equal(f.local, "incierto");
  assert.equal(f.payButton().props.disabled, true);
  assert.equal(f.forgotten.length, 0);
});
test("ID local obsoleto no oculta un intento real abierto en otro dispositivo", async () => {
  const f = fixture();
  f.local = "viejo";
  f.active = "otro";
  f.states.set("otro", estado("otro"));
  await f.settle();
  assert.equal(f.local, "otro");
  assert.equal(f.payButton().props.disabled, true);
});
test("rechazo antes de crear intento no deja ID fantasma y conserva el error original", async () => {
  const f = fixture();
  f.mutationError = new GraphQLError(
    "Configura MP_COLLECTOR_ID",
    "BAD_USER_INPUT",
  );
  await f.settle();
  await f
    .find((n) => n.type === "form")
    .props.onSubmit({ preventDefault() {}, currentTarget: {} });
  await f.settle();
  assert.equal(f.local, null);
  assert.equal(f.payButton().props.disabled, false);
  assert.ok(JSON.stringify(f.render()).includes("Configura MP_COLLECTOR_ID"));
});
test("timeout después de crear intento recupera el pago existente sin generar otro", async () => {
  const f = fixture();
  f.mutationError = async (vars) => {
    const id = vars.datos.claveSolicitud;
    f.states.set(id, estado(id));
    throw new Error("Timeout después de crear");
  };
  await f.settle();
  await f
    .find((n) => n.type === "form")
    .props.onSubmit({ preventDefault() {}, currentTarget: {} });
  await f.settle();
  assert.ok(f.local);
  assert.equal(f.payButton().props.disabled, true);
  assert.equal(
    f.calls.filter((c) => c.query.includes("iniciarPago")).length,
    1,
  );
});
test("consulta exitosa crea una sola solicitud y abre el checkout de Mercado Pago", async () => {
  const f = fixture();
  await f.settle();
  await f
    .find((n) => n.type === "form")
    .props.onSubmit({ preventDefault() {}, currentTarget: {} });
  await f.settle();
  assert.equal(f.redirect, "https://www.mercadopago.com.mx/test");
  assert.equal(
    f.calls.filter((c) => c.query.includes("iniciarPago")).length,
    1,
  );
});
