import type { APIContext } from "astro";
import type { AuthUser } from "../../types";

export type BackendError = {
  message: string;
  extensions?: { code?: string };
};

export type BackendReply<T> = {
  data?: T;
  errors?: BackendError[];
};

type BackendOptions = {
  token?: string;
  authBridge?: boolean;
  requestId?: string;
};

export async function requestBackend<T>(
  body: unknown,
  options: BackendOptions = {},
) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (options.token) headers.set("Authorization", `Bearer ${options.token}`);
  if (options.requestId) headers.set("X-BackOffice-Request-Id", options.requestId);
  if (options.authBridge && import.meta.env.AUTH_BRIDGE_SECRET) {
    headers.set("x-auth-bridge-secret", import.meta.env.AUTH_BRIDGE_SECRET);
  }
  const response = await fetch(
    import.meta.env.BACKEND_GRAPHQL_URL || "http://127.0.0.1:4000/graphql",
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    },
  );
  const payload = (await response.json().catch(() => null)) as
    | BackendReply<T>
    | null;
  return {
    status: response.status,
    body: payload ?? {
      errors: [{ message: "El backend devolvió una respuesta inválida." }],
    },
  };
}

export function mismoOrigen(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

type CookieJar = APIContext["cookies"];

export async function getSessionUser(
  token: string | undefined,
): Promise<{ user: AuthUser | null; invalid: boolean }> {
  if (!token) return { user: null, invalid: false };
  try {
    const { body } = await requestBackend<{ usuarioActual: AuthUser }>(
      { query: "query SesionActual { usuarioActual { id nombre email rol } }" },
      { token },
    );
    if (body.data?.usuarioActual) {
      return { user: body.data.usuarioActual, invalid: false };
    }
    return {
      user: null,
      invalid: body.errors?.some(
        (error) => error.extensions?.code === "UNAUTHENTICATED",
      ) ?? false,
    };
  } catch {
    return { user: null, invalid: false };
  }
}

export async function authenticate(
  request: Request,
  cookies: CookieJar,
  query: string,
  datos: Record<string, string>,
  operation: "registrarUsuario" | "iniciarSesion",
) {
  if (!mismoOrigen(request)) {
    return Response.json({ error: "Solicitud no permitida." }, { status: 403 });
  }
  try {
    const { status, body } = await requestBackend<
      Record<string, { token: string; usuario: AuthUser }>
    >({ query, variables: { datos } }, { authBridge: true });
    const sesion = body.data?.[operation];
    if (!sesion?.token || !sesion.usuario) {
      const error = body.errors?.[0];
      return Response.json(
        { error: error?.message ?? "No se pudo iniciar la sesión." },
        { status: errorStatus(error, status) },
      );
    }

    cookies.set("tl_session", sesion.token, {
      httpOnly: true,
      secure: new URL(request.url).protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return Response.json(
      { usuario: sesion.usuario },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      {
        error:
          "No se pudo contactar al backend GraphQL. Revisa back/.env, PostgreSQL y que NestJS esté activo en el puerto 4000.",
      },
      { status: 502 },
    );
  }
}

export function errorStatus(error: BackendError | undefined, status: number) {
  if (error?.extensions?.code === "UNAUTHENTICATED") return 401;
  if (error?.extensions?.code === "CONFLICT") return 409;
  if (error?.extensions?.code === "BAD_USER_INPUT") return 400;
  if (error?.extensions?.code === "FORBIDDEN") return 403;
  return status >= 400 ? status : 502;
}

export function safeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }
  return value;
}
