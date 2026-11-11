import { Logger } from "@nestjs/common";
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { GraphQLError } from "graphql";
import { PrismaService } from "./prisma.service";

//convierte valor a hash 256
const hash = (valor: string) => createHash("sha256").update(valor).digest("hex");
function fallo(mensaje: string, code = "BAD_USER_INPUT"): never {
  throw new GraphQLError(mensaje, { extensions: { code } });
}
const invalido = "El código es incorrecto o ya venció. Solicita uno nuevo si es necesario.";

export class PasswordRecoveryService {
  private readonly logger = new Logger(PasswordRecoveryService.name);
  constructor(private readonly db: PrismaService) {}


  private hashCodigo(solicitudId: string, codigo: string) {
    const secreto = process.env.JWT_SECRET;
  
    if (!secreto) fallo("La recuperación no está disponible en este momento.", "INTERNAL_SERVER_ERROR");
    return createHmac("sha256", secreto).update(`password-reset:${solicitudId}:${codigo}`).digest("hex");
  }

  async solicitar(emailEntrada: string) {
    const email = emailEntrada.trim().toLowerCase();
  
    if (email.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fallo("Escribe un correo electrónico válido.");
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from = process.env.PASSWORD_RESET_FROM?.trim();
  
    if (!apiKey || !from) {
      this.logger.error("Configura RESEND_API_KEY y PASSWORD_RESET_FROM para la recuperación.");
      fallo("No pudimos enviar el código. Inténtalo más tarde.", "PASSWORD_RESET_EMAIL_FAILED");
    }
  
    const solicitudId = randomBytes(32).toString("base64url");
    const codigo = String(randomInt(100000, 1000000));
    const codigoHash = this.hashCodigo(solicitudId, codigo);
    const ahora = new Date();
  
    const registro = await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(7311, hashtext(${email}))::text`;
      //const reciente = await tx.tokenRecuperacion.findFirst({ where: { email }, orderBy: { creadoEn: "desc" } });
  
      //if (reciente && ahora.getTime() - reciente.creadoEn.getTime() < 60_000) {
        //fallo("Espera un minuto antes de solicitar otro código.", "TOO_MANY_REQUESTS");
      //}
  
      const cantidad = await tx.tokenRecuperacion.count({ where: { email, creadoEn: { gt: new Date(ahora.getTime() - 3600_000) } } });
      if (cantidad >= 10) fallo("Has solicitado varios códigos. Inténtalo de nuevo en una hora.", "TOO_MANY_REQUESTS");
      const usuario = await tx.usuario.findUnique({ where: { email } });
      
      await tx.tokenRecuperacion.updateMany({ where: { email, usadoEn: null }, data: { usadoEn: ahora } });
      return tx.tokenRecuperacion.create({ data: {
        usuarioId: usuario?.passwordHash ? usuario.id : null,
        email, tokenHash: hash(solicitudId), codigoHash,
        expiraEn: new Date(ahora.getTime() + 10 * 60_000),
      } });
    });

    // Se crea el mismo desafío y se responde igual aunque el correo no exista.
    if (registro.usuarioId) {
      try {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `reset-${registro.tokenHash}` },
          body: JSON.stringify({ from, to: [email], subject: "Tu código para recuperar TecnoLeague",
            text: `Tu código para recuperar la contraseña de TecnoLeague es: ${codigo}\nVence en 10 minutos. No compartas este código. Si no solicitaste el cambio, ignora este correo.`,
            html: `<p>Tu código para recuperar la contraseña de TecnoLeague es:</p><p style="font-size:32px;letter-spacing:6px"><strong>${codigo}</strong></p><p>Vence en 10 minutos. No compartas este código. Si no solicitaste el cambio, ignora este correo.</p>`,
          }), signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) { this.logger.error(`Resend rechazó el código (HTTP ${response.status}).`); throw new Error("RESEND_FAILED"); }
      } catch {
        await this.db.tokenRecuperacion.update({ where: { id: registro.id }, data: { usadoEn: new Date() } });
        fallo("No pudimos enviar el código. Inténtalo más tarde.", "PASSWORD_RESET_EMAIL_FAILED");
      }
    }
    return { solicitudId, reintentarEn: 60 };
  }

  async verificar(solicitudId: string, codigo: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(solicitudId) || !/^\d{6}$/.test(codigo)) fallo(invalido);
    
    const tokenHash = hash(solicitudId);
    const resultado = await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM tokens_recuperacion WHERE token_hash = ${tokenHash} FOR UPDATE`;
      const registro = await tx.tokenRecuperacion.findUnique({ where: { tokenHash } });
    
      if (!registro || registro.usadoEn || !registro.codigoHash || registro.intentos >= 5 || registro.expiraEn <= new Date()) return null;
      const esperado = Buffer.from(registro.codigoHash, "hex");
      const recibido = Buffer.from(this.hashCodigo(solicitudId, codigo), "hex");
      const coincide = esperado.length === recibido.length && timingSafeEqual(esperado, recibido);
    
      if (!coincide || !registro.usuarioId) {
        // El contador se confirma antes de devolver el error: no se revierte.
        await tx.tokenRecuperacion.update({ where: { id: registro.id }, data: {
          intentos: { increment: 1 }, ...(registro.intentos >= 4 ? { usadoEn: new Date() } : {}),
        } });
        return null;
      }
      
      const token = randomBytes(32).toString("base64url");
      await tx.tokenRecuperacion.update({ where: { id: registro.id }, data: {
        tokenHash: hash(token), codigoHash: null, verificadoEn: new Date(),
      } });
      return token;
    });
    if (!resultado) fallo(invalido);
    return resultado;
  }

  async restablecer(token: string, passwordHash: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) fallo("La recuperación venció. Solicita un código nuevo.");
    const tokenHash = hash(token);
    
    const cambiado = await this.db.$transaction(async tx => {
      const inicial = await tx.tokenRecuperacion.findUnique({ where: { tokenHash } });
    
      if (!inicial?.usuarioId) return false;
      // Serializa dos cambios y los accesos de recuperación del mismo usuario.
      await tx.$queryRaw`SELECT id FROM usuarios WHERE id = ${inicial.usuarioId} FOR UPDATE`;
      const registro = await tx.tokenRecuperacion.findUnique({ where: { tokenHash } });
    
      if (!registro?.usuarioId || registro.usadoEn || !registro.verificadoEn || registro.codigoHash || registro.expiraEn <= new Date()) return false;
      await tx.usuario.update({ where: { id: registro.usuarioId }, data: { passwordHash, versionSesion: { increment: 1 } } });
      await tx.tokenRecuperacion.updateMany({ where: { usuarioId: registro.usuarioId, usadoEn: null }, data: { usadoEn: new Date() } });
      return true;
    });
    if (!cambiado) fallo("La recuperación venció. Solicita un código nuevo.");
    return true;
  }
}
