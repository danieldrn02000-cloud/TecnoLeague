import { Injectable, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Prisma, Usuario } from "@prisma/client";
import { GraphQLError } from "graphql";
import {
  createHmac,
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  randomUUID,
} from "node:crypto";
import { PrismaService } from "./prisma.service";
import { CredencialesInput, RegistroInput, RequestContext } from "./types";

const HASH_DE_RELLENO = `scrypt$16384$8$1$${Buffer.alloc(16).toString("base64url")}$${Buffer.alloc(64).toString("base64url")}`;
const derivarClave = (password: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      64,
      { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key as Buffer)),
    );
  });

type UsuarioPublico = Pick<Usuario, "id" | "nombre" | "email" | "rol">;

const BACKOFFICE_TICKET_TTL_SECONDS = 60;
const BACKOFFICE_TICKET_ISSUER = "tecnoleague-backend";
const BACKOFFICE_TICKET_AUDIENCE = "tecnoleague-backoffice-subscription";
const BACKOFFICE_TICKET_PURPOSE = "backoffice-subscription";

type BackOfficeTicketClaims = {
  sub: number;
  jti: string;
  iss: string;
  aud: string;
  purpose: string;
  iat: number;
  exp: number;
};

function fallo(message: string, code: string): never {
  throw new GraphQLError(message, { extensions: { code } });
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async registrar(datos: RegistroInput) {
    const nombre = datos.nombre.trim();
    const email = datos.email.trim().toLowerCase();
    if (nombre.length < 2 || nombre.length > 120) {
      fallo("Escribe un nombre de 2 a 120 caracteres.", "BAD_USER_INPUT");
    }
    if (
      email.length > 150 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      fallo("Escribe un correo electrónico válido.", "BAD_USER_INPUT");
    }
    if (datos.password.length < 8 || datos.password.length > 128) {
      fallo("La contraseña debe tener entre 8 y 128 caracteres.", "BAD_USER_INPUT");
    }

    const passwordHash = await this.hashPassword(datos.password);
    try {
      const usuario = await this.db.usuario.create({
        data: { nombre, email, passwordHash, rol: "CLIENTE" },
        select: { id: true, nombre: true, email: true, rol: true },
      });
      return { token: this.crearToken(usuario.id), usuario };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        fallo("Ya existe una cuenta con ese correo.", "CONFLICT");
      }
      throw error;
    }
  }

  async iniciarSesion(datos: CredencialesInput) {
    const email = datos.email.trim().toLowerCase();
    if (!email || datos.password.length > 128) {
      fallo("Correo o contraseña incorrectos.", "UNAUTHENTICATED");
    }
    const usuario = await this.db.usuario.findUnique({ where: { email } });
    const passwordValida = await this.compararPassword(
      datos.password,
      usuario?.passwordHash ?? HASH_DE_RELLENO,
    );
    if (!usuario || !passwordValida) {
      fallo("Correo o contraseña incorrectos.", "UNAUTHENTICATED");
    }
    return {
      token: this.crearToken(usuario.id),
      usuario: this.publico(usuario),
    };
  }

  async solicitarRecuperacion(emailEntrada: string) {
    const email = emailEntrada.trim().toLowerCase();
    const usuario = await this.db.usuario.findUnique({ where: { email } });
    if (usuario?.passwordHash) {
      const token = randomBytes(32).toString("base64url");
      await this.db.tokenRecuperacion.create({
        data: {
          usuarioId: usuario.id,
          tokenHash: createHash("sha256").update(token).digest("hex"),
          expiraEn: new Date(Date.now() + 60 * 60 * 1000),
        },
      });
      await this.enviarEnlaceRecuperacion(email, token);
    }
    return true;
  }

  private async enviarEnlaceRecuperacion(email: string, token: string) {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from = process.env.PASSWORD_RESET_FROM?.trim();
    if (!apiKey || !from) {
      this.logger.error(
        "Recuperación no disponible: configura RESEND_API_KEY y PASSWORD_RESET_FROM.",
      );
      fallo(
        "El correo de recuperación no está configurado.",
        "PASSWORD_RESET_EMAIL_NOT_CONFIGURED",
      );
    }

    let enlace: URL;
    try {
      const base = new URL(
        process.env.PUBLIC_SITE_URL || "http://127.0.0.1:5173",
      );
      if (base.protocol !== "http:" && base.protocol !== "https:") {
        throw new Error("PUBLIC_SITE_URL debe usar HTTP o HTTPS.");
      }
      enlace = new URL("/restablecer-contrasena", base);
      enlace.searchParams.set("token", token);
    } catch {
      this.logger.error("Recuperación no disponible: PUBLIC_SITE_URL no es válido.");
      fallo(
        "La dirección pública del sitio no está configurada correctamente.",
        "PASSWORD_RESET_SITE_URL_INVALID",
      );
    }

    let response: Response;
    try {
      response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [email],
          subject: "Restablece tu contraseña de TecnoLeague",
          text: [
            "Recibimos una solicitud para restablecer la contraseña de tu cuenta TecnoLeague.",
            "",
            `Abre este enlace para elegir una nueva contraseña: ${enlace.toString()}`,
            "",
            "El enlace vence en 1 hora. Si no solicitaste este cambio, ignora este correo.",
          ].join("\n"),
          html: `<p>Recibimos una solicitud para restablecer la contraseña de tu cuenta TecnoLeague.</p><p><a href="${enlace.toString()}">Crear una nueva contraseña</a></p><p>El enlace vence en 1 hora. Si no solicitaste este cambio, ignora este correo.</p>`,
        }),
        signal: AbortSignal.timeout(15000),
      });
    } catch (error) {
      this.logger.error(
        `Falló la conexión con Resend: ${error instanceof Error ? error.message : "error desconocido"}`,
      );
      fallo("No se pudo enviar el correo de recuperación.", "PASSWORD_RESET_EMAIL_FAILED");
    }

    if (!response.ok) {
      this.logger.error(`Resend rechazó el correo (HTTP ${response.status}).`);
      fallo("No se pudo enviar el correo de recuperación.", "PASSWORD_RESET_EMAIL_FAILED");
    }
  }

  async restablecerPassword(token: string, password: string) {
    if (password.length < 8 || password.length > 128) {
      fallo("La contraseña debe tener entre 8 y 128 caracteres.", "BAD_USER_INPUT");
    }
    const registro = await this.db.tokenRecuperacion.findUnique({
      where: { tokenHash: createHash("sha256").update(token).digest("hex") },
    });
    if (!registro || registro.usadoEn || registro.expiraEn < new Date()) {
      fallo("El enlace no es válido o ya expiró.", "BAD_USER_INPUT");
    }
    const passwordHash = await this.hashPassword(password);
    const usado = await this.db.$transaction(async (tx) => {
      const marcado = await tx.tokenRecuperacion.updateMany({
        where: { id: registro.id, usadoEn: null },
        data: { usadoEn: new Date() },
      });
      if (marcado.count !== 1) return false;
      await tx.usuario.update({
        where: { id: registro.usuarioId },
        data: { passwordHash },
      });
      return true;
    });
    if (!usado) fallo("El enlace no es válido o ya expiró.", "BAD_USER_INPUT");
    return true;
  }

  async usuarioActual(ctx: RequestContext): Promise<UsuarioPublico> {
    const valor = ctx.req.headers.authorization;
    const header = Array.isArray(valor) ? valor[0] : valor;
    const token = header?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) fallo("Inicia sesión para continuar.", "UNAUTHENTICATED");

    const id = this.verificarToken(token);
    const usuario = await this.db.usuario.findUnique({
      where: { id },
      select: { id: true, nombre: true, email: true, rol: true },
    });
    if (!usuario) fallo("La sesión ya no es válida.", "UNAUTHENTICATED");
    return usuario;
  }

  //genera y valida tickets de 60 segundos , con firma derivada y propósito exclusivo de backOffice
  crearTicketBackOffice(usuarioId: number) {
    const ahora = Math.floor(Date.now() / 1000);
    const claims: BackOfficeTicketClaims = {
      sub: usuarioId,
      jti: randomUUID(),
      iss: BACKOFFICE_TICKET_ISSUER,
      aud: BACKOFFICE_TICKET_AUDIENCE,
      purpose: BACKOFFICE_TICKET_PURPOSE,
      iat: ahora,
      exp: ahora + BACKOFFICE_TICKET_TTL_SECONDS,
    };
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const contenido = `bo1.${payload}`;
    const ticket = `${contenido}.${this.firmarTicketBackOffice(contenido)}`;

    return {
      ticket,
      expiraEn: new Date(claims.exp * 1000).toISOString(),
    };
  }

  async usuarioBackOfficePorTicket(ticket: string): Promise<UsuarioPublico> {
    const claims = this.verificarTicketBackOffice(ticket);
    const usuario = await this.db.usuario.findUnique({
      where: { id: claims.sub },
      select: { id: true, nombre: true, email: true, rol: true },
    });
    if (!usuario) fallo("La sesión ya no es válida.", "UNAUTHENTICATED");
    if (usuario.rol !== "ADMIN") {
      fallo("No tienes permiso para realizar esta operación.", "FORBIDDEN");
    }
    return usuario;
  }

  private verificarTicketBackOffice(ticket: string): BackOfficeTicketClaims {
    const partes = ticket.split(".");
    if (partes.length !== 3 || partes[0] !== "bo1") {
      fallo("El ticket de administración no es válido.", "UNAUTHENTICATED");
    }

    const contenido = `${partes[0]}.${partes[1]}`;
    const firmaEsperada = Buffer.from(this.firmarTicketBackOffice(contenido));
    const firmaRecibida = Buffer.from(partes[2]);
    if (
      firmaEsperada.length !== firmaRecibida.length ||
      !timingSafeEqual(firmaEsperada, firmaRecibida)
    ) {
      fallo("El ticket de administración no es válido.", "UNAUTHENTICATED");
    }

    let claims: Partial<BackOfficeTicketClaims>;
    try {
      claims = JSON.parse(
        Buffer.from(partes[1], "base64url").toString("utf8"),
      ) as Partial<BackOfficeTicketClaims>;
    } catch {
      fallo("El ticket de administración no es válido.", "UNAUTHENTICATED");
    }

    const ahora = Math.floor(Date.now() / 1000);
    if (
      !Number.isInteger(claims.sub) ||
      (claims.sub ?? 0) < 1 ||
      typeof claims.jti !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(claims.jti) ||
      claims.iss !== BACKOFFICE_TICKET_ISSUER ||
      claims.aud !== BACKOFFICE_TICKET_AUDIENCE ||
      claims.purpose !== BACKOFFICE_TICKET_PURPOSE ||
      !Number.isInteger(claims.iat) ||
      !Number.isInteger(claims.exp) ||
      (claims.iat ?? 0) > ahora ||
      (claims.exp ?? 0) <= ahora ||
      (claims.exp ?? 0) - (claims.iat ?? 0) !==
        BACKOFFICE_TICKET_TTL_SECONDS
    ) {
      fallo("El ticket de administración expiró o no es válido.", "UNAUTHENTICATED");
    }

    return claims as BackOfficeTicketClaims;
  }

  private firmarTicketBackOffice(contenido: string) {
    const secreto = process.env.JWT_SECRET;
    if (!secreto) throw new Error("Falta JWT_SECRET en el backend.");
    const clave = createHmac("sha256", secreto)
      .update("tecnoleague:backoffice-subscription-ticket:v1")
      .digest();
    return createHmac("sha256", clave)
      .update(contenido)
      .digest("base64url");
  }

  private publico(usuario: Usuario): UsuarioPublico {
    return {
      id: usuario.id,
      nombre: usuario.nombre,
      email: usuario.email,
      rol: usuario.rol,
    };
  }

  private async hashPassword(password: string) {
    const salt = randomBytes(16).toString("base64url");
    const hash = await derivarClave(password, salt);
    return `scrypt$16384$8$1$${salt}$${hash.toString("base64url")}`;
  }

  private async compararPassword(password: string, encoded: string) {
    const [, algoritmo, n, r, p, salt, hash] = encoded.match(
      /^(scrypt)\$(\d+)\$(\d+)\$(\d+)\$([^$]+)\$([^$]+)$/,
    ) ?? [];
    if (!algoritmo || n !== "16384" || r !== "8" || p !== "1") return false;
    const esperado = Buffer.from(hash, "base64url");
    const recibido = await derivarClave(password, salt);
    return (
      esperado.length === recibido.length && timingSafeEqual(esperado, recibido)
    );
  }

  private crearToken(usuarioId: number) {
  return this.jwt.sign(
    { sub: usuarioId },
    { expiresIn: "7d" },
  );
}

  private verificarToken(token: string): number {
    try {
      const claims = this.jwt.verify<{ sub: number; exp: number }>(token);
      if (
        !Number.isInteger(claims.sub) || claims.sub < 1 ||
        !Number.isInteger(claims.exp) ||
        claims.exp <= Math.floor(Date.now() / 1000)
      ) {
        fallo("La sesión ya no es válida.", "UNAUTHENTICATED");
      }
      return claims.sub;
    } catch (error) {
      if (error instanceof GraphQLError) throw error;
      if (error instanceof Error && error.name === "TokenExpiredError") {
        fallo("La sesión expiró. Inicia sesión de nuevo.", "UNAUTHENTICATED");
      }
      fallo("La sesión ya no es válida.", "UNAUTHENTICATED");
    }
  }
}
