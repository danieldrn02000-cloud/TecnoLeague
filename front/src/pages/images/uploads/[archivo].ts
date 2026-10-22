import type { APIRoute } from "astro";
import { backendResourceUrl } from "../../../lib/server/imagenes";

export const prerender = false;
export const GET: APIRoute = async ({ params }) => {
  const archivo = params.archivo || "";
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(jpg|png)$/.test(
      archivo,
    )
  ) {
    return new Response(null, { status: 404 });
  }
  try {
    const response = await fetch(backendResourceUrl(`/imagenes/${archivo}`), {
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      return new Response(null, {
        status: response.status === 404 ? 404 : 502,
      });
    return new Response(response.body, {
      headers: {
        "Content-Type": archivo.endsWith(".png") ? "image/png" : "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response(null, { status: 502 });
  }
};
