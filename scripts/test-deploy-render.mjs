import { test } from "node:test";
import assert from "node:assert/strict";
import { deployRender, validateConfig } from "./deploy-render.mjs";

const env = {
  RENDER_API_KEY: "secreto-render",
  RENDER_SERVICE_ID: "srv-test",
  NETLIFY_AUTH_TOKEN: "secreto-netlify",
  NETLIFY_SITE_ID: "site-test",
  PRODUCTION_SITE_URL: "https://tienda.test",
  GITHUB_SHA: "a".repeat(40),
};
test("no publica si falta configuración", async () => {
  assert.throws(
    () => validateConfig({ ...env, NETLIFY_AUTH_TOKEN: "" }),
    /NETLIFY_AUTH_TOKEN/,
  );
  let calls = 0;
  await assert.rejects(
    deployRender(
      { ...env, GITHUB_SHA: "" },
      {
        request: async () => {
          calls++;
        },
      },
    ),
  );
  assert.equal(calls, 0);
});
test("Render recibe el SHA validado y se espera a que ese commit esté live", async () => {
  const calls = [];
  const responses = [
    { id: "dep-1" },
    { status: "build_in_progress" },
    { status: "live", commit: { id: env.GITHUB_SHA } },
  ];
  await deployRender(env, {
    request: async (url, options) => {
      calls.push({ url, options });
      return Response.json(responses.shift());
    },
    sleep: async () => {},
    log: () => {},
  });
  assert.equal(JSON.parse(calls[0].options.body).commitId, env.GITHUB_SHA);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(
    calls[1].url,
    "https://api.render.com/v1/services/srv-test/deploys/dep-1",
  );
  assert.equal(calls.length, 3);
});
for (const current of [
  { status: "build_failed" },
  { status: "live", commit: { id: "b".repeat(40) } },
]) {
  test(`interrumpe la publicación: ${current.status}`, async () => {
    const responses = [{ id: "dep-1" }, current];
    await assert.rejects(
      deployRender(env, {
        request: async () => Response.json(responses.shift()),
        sleep: async () => {},
        log: () => {},
      }),
    );
  });
}
test("no reenvía el POST ni expone la respuesta privada ante errores HTTP", async () => {
  let calls = 0;
  await assert.rejects(
    deployRender(env, {
      request: async () => {
        calls++;
        return new Response("secreto-render", { status: 401 });
      },
    }),
    (error) =>
      !error.message.includes("secreto-render") &&
      error.message.includes("401"),
  );
  assert.equal(calls, 1);
});
