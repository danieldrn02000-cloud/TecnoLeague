const site = new URL(process.env.PRODUCTION_SITE_URL);
if (site.protocol !== "https:" || site.username || site.password)
  throw new Error("Configura la URL HTTPS pública de producción.");
const home = await fetch(site, { signal: AbortSignal.timeout(60000) });
if (!home.ok || !home.headers.get("content-type")?.includes("text/html"))
  throw new Error(`La tienda no respondió correctamente: HTTP ${home.status}.`);
const api = await fetch(new URL("/api/graphql", site), {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: site.origin },
  body: JSON.stringify({
    query: "query SaludDespliegue { categorias { id } }",
  }),
  signal: AbortSignal.timeout(60000),
});
const body = await api.json().catch(() => null);
if (!api.ok || body?.errors?.length || !Array.isArray(body?.data?.categorias))
  throw new Error(
    "La tienda no pudo consultar el catálogo a través de Astro y NestJS.",
  );
console.log(
  "Producción verificada: página HTML y catálogo público disponibles.",
);
