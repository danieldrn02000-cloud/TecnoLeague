import type { APIRoute } from "astro";
import { randomBytes } from "node:crypto";
import { authenticate, mismoOrigen } from "../../../lib/server/graphql";

export const prerender = false;
const COOKIE = "tl_google_nonce";
const query = `mutation Google($datos:GoogleInput!){iniciarSesionGoogle(datos:$datos){token usuario{id nombre email rol}}}`;

//PREPARACION Y AUTENTICACION 
export const POST: APIRoute = async ({ request, cookies }) => {
  if (!mismoOrigen(request))
    return Response.json({ error: "Solicitud no permitida." }, { status: 403 });
  try {
    const body = await request.json();
    if (body?.accion === "preparar") {
      const nonce = randomBytes(32).toString("base64url");
      
      cookies.set(COOKIE, nonce, {
        httpOnly: true,
        secure: new URL(request.url).protocol === "https:",
        sameSite: "lax",
        path: "/api/auth/google",
        maxAge: 600,
      });
      return Response.json(
        { nonce },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    
    const nonce = cookies.get(COOKIE)?.value;
    if (
      !nonce ||
      typeof body?.credential !== "string" ||
      body.credential.length > 16000 ||
      (body.password !== undefined &&
        (typeof body.password !== "string" || body.password.length > 128))
    ) {
      return Response.json(
        { error: "Vuelve a iniciar el acceso con Google." },
        { status: 400 },
      );
    }
    const response = await authenticate(
      request,
      cookies,
      query,
      {
        credential: body.credential,
        nonce,
        ...(body.password ? { password: body.password } : {}),
      },
      "iniciarSesionGoogle",
    );
    
    const result = await response.clone().json();
    if (result.code !== "GOOGLE_LINK_REQUIRED")
      cookies.delete(COOKIE, { path: "/api/auth/google" });
    return response;
  } catch {
    return Response.json(
      { error: "No pudimos iniciar sesión con Google. Inténtalo de nuevo." },
      { status: 400 },
    );
  }
};
