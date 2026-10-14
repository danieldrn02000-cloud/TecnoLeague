import type { APIRoute } from "astro";
import { mismoOrigen } from "../../../lib/server/graphql";

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!mismoOrigen(request)) {
    return new Response("Solicitud no permitida.", { status: 403 });
  }
  cookies.delete("tl_session", { path: "/" });
  return new Response(null,{
    //este estado indica al navegador que despues del post de logout, haga una peticion GET a la direccion indicadaen location
    status:303, 
    headers: {
      Location: new URL("/", request.url).toString(), //eliminamos  la cabecera inmutable para que netlify pueda poner set-cookie
      "cache-control":"no store" //esto pide que la respuesta del logout no se almacen en caché
    }
  });
};