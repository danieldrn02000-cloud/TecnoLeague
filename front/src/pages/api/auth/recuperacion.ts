import type { APIRoute } from "astro";
import { mismoOrigen, requestBackend } from "../../../lib/server/graphql";

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  const responder = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

  if (!mismoOrigen(request))
    return responder({ error: "Solicitud no permitida." }, 403);
  let datos: Record<string, unknown>;

  //envia solicitud
  try {
    datos = await request.json(); //convierte la request a json 
  } catch {
    return responder({ error: "Solicitud inválida." }, 400);
  }

  if (!datos || typeof datos !== "object")
    return responder({ error: "Solicitud inválida." }, 400);

  //configuracion de cookie
  //aqui estan los cambios
  const opciones = {
    httpOnly: true,
    secure: new URL(request.url).protocol === "https:",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600,
  };

  try {
    //veritifca datos
    if (datos.accion === "solicitar") {
      const email =
        typeof datos.email === "string"
          ? datos.email.trim().toLowerCase()
          : cookies.get("tl_reset_email")?.value;
      if (
        !email ||
        email.length > 150 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      )
        return responder(
          { error: "Escribe un correo electrónico válido." },
          400,
        );
      const { body } = await requestBackend<{
        solicitarRecuperacion: { solicitudId: string };
      }>(
        {
          query:
            "mutation($email:String!){solicitarRecuperacion(email:$email){solicitudId reintentarEn}}",
          variables: { email },
        },
        { authBridge: true },
      );
      
      if (!body.data?.solicitarRecuperacion) {
        const error = body.errors?.[0];
        return responder(
          {
            error:
              error?.extensions?.code === "TOO_MANY_REQUESTS"
                ? error.message
                : "No pudimos enviar el código. Inténtalo más tarde.",
          },
          error?.extensions?.code === "TOO_MANY_REQUESTS" ? 429 : 502,
        );
      }
      cookies.set(
        "tl_reset_challenge",
        body.data.solicitarRecuperacion.solicitudId,
        opciones,
      );
      cookies.set("tl_reset_email", email, opciones);
      cookies.delete("tl_reset_token", { path: "/" });
      return responder({ ok: true });
    }
    if (datos.accion === "verificar") {
      const solicitudId = cookies.get("tl_reset_challenge")?.value;
      
      if (
        !solicitudId ||
        typeof datos.codigo !== "string" ||
        !/^\d{6}$/.test(datos.codigo)
      )
        return responder(
          { error: "Escribe el código de seis dígitos que recibiste." },
          400,
        );
      
        const { body } = await requestBackend<{
        verificarCodigoRecuperacion: string;
      }>(
        {
          query:
            "mutation($solicitudId:String!,$codigo:String!){verificarCodigoRecuperacion(solicitudId:$solicitudId,codigo:$codigo)}",
          variables: { solicitudId, codigo: datos.codigo },
        },
        { authBridge: true },
      );
      
      if (!body.data?.verificarCodigoRecuperacion)
        return responder(
          {
            error:
              "El código es incorrecto o ya venció. Solicita uno nuevo si es necesario.",
          },
          400,
        );
      cookies.set(
        "tl_reset_token",
        body.data.verificarCodigoRecuperacion,
        opciones,
      );
      
      cookies.delete("tl_reset_challenge", { path: "/" });
      return responder({ ok: true });
    }
    if (datos.accion === "restablecer") {
      const token = cookies.get("tl_reset_token")?.value;
      if (!token)
        return responder(
          { error: "La recuperación venció. Solicita un código nuevo." },
          400,
        );
      
        if (
        typeof datos.password !== "string" ||
        datos.password.length < 8 ||
        datos.password.length > 128
      )
        return responder(
          { error: "La contraseña debe tener entre 8 y 128 caracteres." },
          400,
        );
      
        if (datos.password !== datos.confirmPassword)
        return responder({ error: "Las contraseñas no coinciden." }, 400);
      
        const { body } = await requestBackend<{ restablecerPassword: boolean }>(
        {
          query:
            "mutation($token:String!,$password:String!){restablecerPassword(token:$token,password:$password)}",
          variables: { token, password: datos.password },
        },
        { authBridge: true },
      );
      if (!body.data?.restablecerPassword)
        return responder(
          {
            error:
              "No pudimos cambiar la contraseña. Solicita un código nuevo e inténtalo otra vez.",
          },
          400,
        );
      
        for (const nombre of [
        "tl_reset_token",
        "tl_reset_email",
        "tl_reset_challenge",
        "tl_session",
      ])
        cookies.delete(nombre, { path: "/" });
      return responder({ ok: true });
    }
    
    return responder({ error: "Solicitud inválida." }, 400);
  } catch {
    return responder(
      {
        error: "No pudimos completar la solicitud. Inténtalo en unos momentos.",
      },
      502,
    );
  }
};
