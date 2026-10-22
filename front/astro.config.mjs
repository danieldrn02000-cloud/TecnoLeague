import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import { loadEnv } from "vite";

import netlify from "@astrojs/netlify";

// PUBLIC_* se incorpora al JavaScript del navegador durante el build.
// Una variable disponible solo en Functions no corrige un bundle ya publicado.
if (process.env.NETLIFY === "true" && !process.env.PUBLIC_MP_PUBLIC_KEY?.trim()) {
  throw new Error(
    "Netlify: falta PUBLIC_MP_PUBLIC_KEY durante el build. Configúrala en Environment variables con scope Builds para el contexto del deploy y vuelve a desplegar. No se necesita front/.env en Netlify.",
  );
}

// El navegador usa el mismo origen; la dirección privada solo la usa Astro.
const env = loadEnv(
  process.env.NODE_ENV || "development",
  process.cwd(),
  "BACKEND_",
);
const backend = new URL(
  process.env.BACKEND_GRAPHQL_URL ||
    env.BACKEND_GRAPHQL_URL ||
    "http://127.0.0.1:4000/graphql",
);

export default defineConfig({
  output: "server",
  adapter: netlify({
    devFeatures: {
      edgeFunctions: false,
    },
  }),
  integrations: [react()],
  server: { host: "0.0.0.0", port: 5173, strictPort: true },
  vite: {
    plugins: [tailwindcss()],
    server: {
      proxy: {
        "/api/backoffice-ws": {
          target: backend.origin,
          ws: true,
          changeOrigin: true,
          rewrite: () => backend.pathname + backend.search,
        },
      },
    },
  },
});
