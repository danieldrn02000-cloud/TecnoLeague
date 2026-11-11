import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Prisma, Usuario } from "@prisma/client";
import { GraphQLError } from "graphql";
import {
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  randomUUID,
} from "node:crypto";
import { PrismaService } from "./prisma.service";
import { CredencialesInput, RegistroInput, RequestContext } from "./types";
import { PasswordRecoveryService } from "./password-recovery.service";

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
  constructor(
    private readonly db: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  //verifica datos del usuario
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

    const passwordHash = await this.hashPassword(datos.password); //la contraseña se hashea
    //genera cliente, si hay error lo muestra en fallo
    try {
      const usuario = await this.db.usuario.create({
        data: { nombre, email, passwordHash, rol: "CLIENTE" },
        select: { id: true, nombre: true, email: true, rol: true },
      });
      return { token: this.crearToken(usuario.id), usuario };//crea el token del usuario
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

  //recibe credenciales input
  async iniciarSesion(datos: CredencialesInput) {
    const email = datos.email.trim().toLowerCase(); //email a minustculas
    if (!email || datos.password.length > 128) {
      fallo("Correo o contraseña incorrectos.", "UNAUTHENTICATED");
    }
    //compara datos 
    const usuario = await this.db.usuario.findUnique({ where: { email } });
    const passwordValida = await this.compararPassword(
      datos.password,
      usuario?.passwordHash ?? HASH_DE_RELLENO,
    );
    if (!usuario || !passwordValida) {
      fallo("Correo o contraseña incorrectos.", "UNAUTHENTICATED");
    }
    //si todo sale bien se crea el token de la sesión del cliente
    return {
      token: this.crearToken(usuario.id, usuario.versionSesion),
      usuario: this.publico(usuario),
    };
  }

  //delega esta función a passwordRecoveryService y envia el email
  async solicitarRecuperacion(email: string) {
    return new PasswordRecoveryService(this.db).solicitar(email);
  }

  //tambien se delega este servicio
  async verificarCodigoRecuperacion(solicitudId: string, codigo: string) {
    return new PasswordRecoveryService(this.db).verificar(solicitudId, codigo);
  }

  //REESTABLECIMIENTO DE CONTRASEÑA
  async restablecerPassword(token: string, password: string) {
    //verifica contrasña
    if (password.length < 8 || password.length > 128) {
      fallo("La contraseña debe tener entre 8 y 128 caracteres.", "BAD_USER_INPUT");
    }
    //utiliza el servicio inyectado y manda token y la contraseña hasheada como argumentos
    return new PasswordRecoveryService(this.db).restablecer(token, await this.hashPassword(password));
  }


  async usuarioActual(ctx: RequestContext): Promise<UsuarioPublico> {
    const valor = ctx.req.headers.authorization;
    const header = Array.isArray(valor) ? valor[0] : valor;
    const token = header?.match(/^Bearer\s+(.+)$/i)?.[1];
    //verifica que haya token
    if (!token) fallo("Inicia sesión para continuar.", "UNAUTHENTICATED");

    const { id, versionSesion } = this.verificarToken(token);
    //busca al usuario
    const usuario = await this.db.usuario.findUnique({
      where: { id },
      select: { id: true, nombre: true, email: true, rol: true, versionSesion: true },
    });
    //filtra fallos, si todo sale bien regresa el id, nombre, email y rol del usuario
    if (!usuario || usuario.versionSesion !== versionSesion) fallo("La sesión ya no es válida.", "UNAUTHENTICATED");
    return { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol };
  }

  //genera y valida tickets de 60 segundos
  crearTicketBackOffice(usuarioId: number) {
    //obtiene fecha actual y genera el ticket
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
    //carga payload, contenido y ticket firmado
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
    //filtra por sesion valida y rol admin
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

  //crea token con duracion de 7 dias
  private crearToken(usuarioId: number, versionSesion = 0) {
  return this.jwt.sign(
    { sub: usuarioId, sv: versionSesion },
    { expiresIn: "7d" },
  );
}

  private verificarToken(token: string): { id: number; versionSesion: number } {
    try {
      const claims = this.jwt.verify<{ sub: number; exp: number; sv?: number }>(token);
      if (
        !Number.isInteger(claims.sub) || claims.sub < 1 ||
        !Number.isInteger(claims.exp) ||
        claims.exp <= Math.floor(Date.now() / 1000) ||
        !Number.isInteger(claims.sv ?? 0) || (claims.sv ?? 0) < 0
      ) {
        fallo("La sesión ya no es válida.", "UNAUTHENTICATED");
      }
      return { id: claims.sub, versionSesion: claims.sv ?? 0 };
    
    } catch (error) {
      if (error instanceof GraphQLError) throw error;
      if (error instanceof Error && error.name === "TokenExpiredError") {
        fallo("La sesión expiró. Inicia sesión de nuevo.", "UNAUTHENTICATED");
      }
      fallo("La sesión ya no es válida.", "UNAUTHENTICATED");
    }
  }
}
