import { pathToFileURL } from "node:url";

export function validateConfig(env) {
  for (const key of [
    "RENDER_API_KEY",
    "RENDER_SERVICE_ID",
    "NETLIFY_AUTH_TOKEN",
    "NETLIFY_SITE_ID",
    "PRODUCTION_SITE_URL",
  ]) {
    if (!env[key]?.trim())
      throw new Error(`Falta configurar ${key} para producción.`);
  }
  const site = new URL(env.PRODUCTION_SITE_URL);
  if (
    site.protocol !== "https:" ||
    site.username ||
    site.password ||
    site.pathname !== "/" ||
    site.search ||
    site.hash
  )
    throw new Error(
      "PRODUCTION_SITE_URL debe ser la dirección HTTPS pública de la tienda.",
    );
  if (!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || ""))
    throw new Error("GITHUB_SHA no contiene un commit válido.");
}

export async function deployRender(
  env,
  {
    request = fetch,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    maxPolls = 120,
    log = console.log,
  } = {},
) {
  validateConfig(env);
  const base = `https://api.render.com/v1/services/${encodeURIComponent(env.RENDER_SERVICE_ID)}/deploys`;
  const headers = {
    Authorization: `Bearer ${env.RENDER_API_KEY}`,
    "Content-Type": "application/json",
  };
  async function api(url, options = {}) {
    let response;
    try {
      response = await request(url, {
        ...options,
        headers,
        signal: AbortSignal.timeout(30000),
        redirect: "error",
      });
    } catch {
      throw new Error("No se pudo contactar a la API de Render.");
    }
    // No imprimir respuestas completas: pueden contener configuración privada.
    if (!response.ok)
      throw new Error(
        `Render respondió HTTP ${response.status}. Revisa el servicio y las credenciales configuradas.`,
      );
    try {
      return await response.json();
    } catch {
      throw new Error("Render devolvió una respuesta JSON inválida.");
    }
  }
  const deploy = await api(base, {
    method: "POST",
    body: JSON.stringify({
      commitId: env.GITHUB_SHA,
      clearCache: "do_not_clear",
    }),
  });
  if (!deploy.id)
    throw new Error("Render no devolvió un identificador de despliegue.");
  const failed = new Set([
    "build_failed",
    "update_failed",
    "pre_deploy_failed",
    "canceled",
    "deactivated",
  ]);
  const deadline = Date.now() + 20 * 60 * 1000;
  for (
    let attempt = 0;
    attempt < maxPolls && Date.now() < deadline;
    attempt++
  ) {
    const current = await api(`${base}/${encodeURIComponent(deploy.id)}`);
    if (current.status === "live") {
      if (current.commit?.id !== env.GITHUB_SHA)
        throw new Error(
          "Render publicó un commit diferente al validado. Netlify no se desplegará.",
        );
      log(`Render está activo con el commit ${env.GITHUB_SHA}.`);
      return;
    }
    if (failed.has(current.status))
      throw new Error(
        `El despliegue de Render terminó en ${current.status}. Netlify no se desplegará.`,
      );
    if (attempt % 6 === 0)
      log(`Esperando a Render: ${current.status || "pendiente"}.`);
    await sleep(10000);
  }
  throw new Error(
    "Render no terminó el despliegue en 20 minutos. Netlify no se desplegará.",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    if (process.argv.includes("--check")) {
      validateConfig(process.env);
      console.log("Configuración de despliegue completa.");
    } else await deployRender(process.env);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
