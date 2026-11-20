import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  Logger,
  NotFoundException,
  Param,
  PayloadTooLargeException,
  Post,
  Req,
  ServiceUnavailableException,
  StreamableFile,
  UnauthorizedException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { GraphQLError } from "graphql";
import { IncomingMessage } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import sharp from "sharp";
import { AuthService } from "./auth.service";

const MAX_BYTES = 5 * 1024 * 1024;
const ARCHIVO =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(jpg|png|webp)$/;
const FORMATOS: Record<string, string> = {
  "image/jpeg": "jpeg", "image/png": "png", "image/avif": "heif",
  "image/webp": "webp", "image/gif": "gif", "image/tiff": "tiff",
  "image/x-tiff": "tiff",
};
const MENSAJE_FORMATO = "Selecciona una imagen JPG, JPEG, PNG, AVIF, WebP, GIF o TIFF.";

@Controller("imagenes")
export class ImagenesController {
  private readonly logger = new Logger(ImagenesController.name);

  constructor(private readonly auth: AuthService) {}

  private directorio() {
    return resolve(
      process.env.IMAGE_UPLOAD_DIR || resolve(__dirname, "../uploads"),
    );
  }

  private async subirCloudinary(urlConfiguracion: string, contenido: Buffer) {
    let configuracion: URL;
    let apiKey: string;
    let apiSecret: string;
    try {
      configuracion = new URL(urlConfiguracion);
      apiKey = decodeURIComponent(configuracion.username);
      apiSecret = decodeURIComponent(configuracion.password);
      if (
        configuracion.protocol !== "cloudinary:" ||
        !/^[a-z0-9_-]+$/i.test(configuracion.hostname) ||
        !/^\d+$/.test(apiKey) || !apiSecret
      ) {
        throw new Error("Se requieren el nombre del entorno, la clave y el secreto.");
      }
    } catch {
      this.logger.error("La variable CLOUDINARY_URL es inválida.");
      throw new ServiceUnavailableException("La subida de imágenes necesita configuración.");
    }

    try {
      const { v2: cloudinary } = await import("cloudinary");
      return await new Promise<string>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream({
          cloud_name: configuracion.hostname,
          api_key: apiKey,
          api_secret: apiSecret,
          resource_type: "image",
          type: "upload",
          folder: "tecnoleague/productos",
          public_id: randomUUID(),
          overwrite: false,
          timeout: 15000,
          disable_promises: true,
        }, (error, resultado) => {
          const url = resultado?.secure_url;
          if (error || typeof url !== "string" || !url.startsWith("https://") || url.length > 1000) {
            reject(error ?? new Error("Cloudinary no devolvió una URL pública válida."));
            return;
          }
          resolve(url);
        });
        stream.once("error", reject).end(contenido);
      });
    } catch (error) {
      const codigo = (error as { http_code?: unknown } | undefined)?.http_code;
      this.logger.error(typeof codigo === "number"
        ? `Falló la subida a Cloudinary (HTTP ${codigo}).`
        : "Falló la subida a Cloudinary.");
      throw new ServiceUnavailableException("No se pudo subir la imagen. Inténtalo de nuevo.");
    }
  }

  @Post()
  async subir(@Req() request: IncomingMessage) {
    try {
      const usuario = await this.auth.usuarioActual({
        req: { headers: request.headers },
      });
      if (usuario.rol !== "ADMIN")
        throw new ForbiddenException(
          "Solo administradores pueden subir imágenes.",
        );
    } catch (error) {
      if (
        error instanceof GraphQLError &&
        error.extensions.code === "UNAUTHENTICATED"
      ) {
        throw new UnauthorizedException("Inicia sesión para subir imágenes.");
      }
      throw error;
    }
    const tipo = request.headers["content-type"]?.split(";")[0];
    if (!tipo || !FORMATOS[tipo]) {
      throw new UnsupportedMediaTypeException(
        MENSAJE_FORMATO,
      );
    }
    if (Number(request.headers["content-length"]) > MAX_BYTES) {
      throw new PayloadTooLargeException(
        "La imagen debe pesar como máximo 5 MB.",
      );
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > MAX_BYTES)
        throw new PayloadTooLargeException(
          "La imagen debe pesar como máximo 5 MB.",
        );
      chunks.push(Buffer.from(chunk));
    }
    let contenido: Buffer;
    try {
      const image = sharp(Buffer.concat(chunks), {
        limitInputPixels: 40_000_000,
        failOn: "warning",
        page: 0,
        pages: 1,
      });
      const metadata = await image.metadata();
      if (
        metadata.format !== FORMATOS[tipo] ||
        (tipo === "image/avif" && metadata.compression !== "av1")
      ) {
        throw new Error("Formato incorrecto");
      }
      // Decodificar y volver a codificar evita guardar archivos disfrazados de imagen.
      const resized = image
        .rotate()
        .resize(2400, 2400, { fit: "inside", withoutEnlargement: true });
      contenido = await (
        tipo === "image/png" ? resized.png()
          : tipo === "image/jpeg" ? resized.jpeg({ quality: 90 })
          : resized.webp({ quality: 85 })
      ).toBuffer();
    } catch {
      throw new BadRequestException(
        "El archivo no es una imagen válida de un formato admitido (máximo 40 megapíxeles).",
      );
    }
    if (contenido.length > MAX_BYTES)
      throw new PayloadTooLargeException(
        "La imagen procesada supera los 5 MB. Reduce sus dimensiones.",
      );

    const cloudinaryUrl = process.env.CLOUDINARY_URL?.trim();
    if (cloudinaryUrl) return { imagen: await this.subirCloudinary(cloudinaryUrl, contenido) };
    if (process.env.NODE_ENV === "production" || process.env.RENDER === "true") {
      this.logger.error("Falta CLOUDINARY_URL para habilitar la subida de imágenes.");
      throw new ServiceUnavailableException("La subida de imágenes necesita configuración.");
    }

    const archivo = `${randomUUID()}.${tipo === "image/png" ? "png" : tipo === "image/jpeg" ? "jpg" : "webp"}`;
    try {
      await mkdir(this.directorio(), { recursive: true });
      await writeFile(resolve(this.directorio(), archivo), contenido, {
        flag: "wx",
        mode: 0o640,
      });
    } catch {
      throw new HttpException(
        "No se pudo guardar la imagen. Revisa IMAGE_UPLOAD_DIR y los permisos de escritura del backend.",
        503,
      );
    }
    return { imagen: `/images/uploads/${archivo}` };
  }

  @Get(":archivo")
  async obtener(@Param("archivo") archivo: string) {
    if (!ARCHIVO.test(archivo)) throw new NotFoundException();
    let contenido: Buffer;
    try {
      contenido = await readFile(resolve(this.directorio(), archivo));
    } catch {
      throw new NotFoundException("La imagen no existe.");
    }
    return new StreamableFile(contenido, {
      type: archivo.endsWith(".png") ? "image/png" : archivo.endsWith(".webp") ? "image/webp" : "image/jpeg",
      disposition: "inline",
      length: contenido.length,
    });
  }
}
