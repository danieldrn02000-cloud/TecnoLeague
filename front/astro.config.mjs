import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import { loadEnv } from "vite";

import netlify from "@astrojs/netlify";

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
