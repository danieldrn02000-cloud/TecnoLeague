import { Injectable } from "@nestjs/common";
import { GraphQLError } from "graphql";
import { OAuth2Client } from "google-auth-library";

@Injectable()
export class GoogleIdentityService {
  private readonly client = new OAuth2Client();

  async verificar(credential: string, nonce: string) {
    const audience = process.env.GOOGLE_CLIENT_ID?.trim();
    if (!audience) {
      throw new GraphQLError(
        "El acceso con Google no está disponible en este momento.",
        {
          extensions: { code: "GOOGLE_UNAVAILABLE" },
        },
      );
    }
    try {
      if (
        !credential ||
        credential.length > 16000 ||
        !/^[\w-]{32,128}$/.test(nonce)
      )
        throw new Error();
      // La biblioteca oficial verifica firma, emisor, destinatario y caducidad.
      const ticket = await this.client.verifyIdToken({
        idToken: credential,
        audience,
      });
      const claims = ticket.getPayload();
      if (
        !claims ||
        claims.nonce !== nonce ||
        claims.email_verified !== true ||
        !claims.sub ||
        claims.sub.length > 255 ||
        !claims.email ||
        claims.email.length > 150 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.email)
      )
        throw new Error();
      return {
        subject: claims.sub,
        email: claims.email.toLowerCase(),
        nombre:
          (claims.name || claims.email.split("@")[0]).trim().slice(0, 120) ||
          "Cliente",
      };
    } catch {
      // No registrar credenciales ni detalles de tokens en errores o logs.
      throw new GraphQLError(
        "No pudimos verificar tu cuenta de Google. Inténtalo de nuevo.",
        {
          extensions: { code: "UNAUTHENTICATED" },
        },
      );
    }
  }
}
