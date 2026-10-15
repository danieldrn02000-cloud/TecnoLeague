import type { APIRoute } from "astro";
import { mismoOrigen } from "../../../lib/server/graphql";

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!mismoOrigen(request)) {
    return new Response("Solicitud no permitida.", { status: 403 });
  }
  cookies.delete("tl_session", { path: "/" });
  return new Response(null, {
    status: 303,
    headers: {
      Location: new URL("/", request.url).toString(),
      "Cache-Control": "no-store",
    },
  });
};
