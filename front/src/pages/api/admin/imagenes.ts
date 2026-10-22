import type { APIRoute } from "astro";
import { getSessionUser, mismoOrigen } from "../../../lib/server/graphql";
import { backendResourceUrl } from "../../../lib/server/imagenes";

export const prerender = false;
const MAX_BYTES = 5 * 1024 * 1024;
const reply = (error: string, status: number) =>
  Response.json(
    { error },
    { status, headers: { "Cache-Control": "no-store" } },
  );

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!mismoOrigen(request)) return reply("Solicitud no permitida.", 403);
  const token = cookies.get("tl_session")?.value;
  if (!token) return reply("Inicia sesión para subir imágenes.", 401);
  const { user, invalid } = await getSessionUser(token);
  if (invalid) return reply("La sesión expiró. Inicia sesión de nuevo.", 401);
  if (!user)
    return reply("No se pudo verificar la sesión con el backend.", 502);
  if (user.rol !== "ADMIN")
    return reply("Solo administradores pueden subir imágenes.", 403);
  // Limitar también el multipart antes de que formData lo cargue en memoria.
  const limite = MAX_BYTES + 64 * 1024;
  if (Number(request.headers.get("content-length")) > limite)
    return reply("La imagen debe pesar como máximo 5 MB.", 413);
  let form: FormData;
  try {
    const reader = request.body?.getReader();
    if (!reader) return reply("Selecciona una imagen.", 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limite) {
          await reader.cancel();
          return reply("La imagen debe pesar como máximo 5 MB.", 413);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    form = await new Response(bytes, {
      headers: { "Content-Type": request.headers.get("content-type") || "" },
    }).formData();
  } catch {
    return reply("El archivo enviado no es válido.", 400);
  }
  const file = form.get("imagen");
  if (!(file instanceof File) || !file.size)
    return reply("Selecciona una imagen.", 400);
  if (
    !/\.(jpe?g|png)$/i.test(file.name) ||
    !["image/jpeg", "image/png"].includes(file.type)
  ) {
    return reply("Selecciona una imagen JPG, JPEG o PNG.", 415);
  }
  if (file.size > MAX_BYTES)
    return reply("La imagen debe pesar como máximo 5 MB.", 413);
  try {
    const response = await fetch(backendResourceUrl("/imagenes"), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": file.type },
      body: await file.arrayBuffer(),
      signal: AbortSignal.timeout(30000),
    });
    const body = await response.json();
    if (!response.ok)
      return reply(
        typeof body.message === "string"
          ? body.message
          : "No se pudo guardar la imagen.",
        response.status,
      );
    return Response.json(
      { imagen: body.imagen },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return reply(
      "No se pudo contactar al backend para guardar la imagen.",
      502,
    );
  }
};
