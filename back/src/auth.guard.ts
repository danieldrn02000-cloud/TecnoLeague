//valida el Bearer y guarda el usuario autenticado en el contexto de GraphQL
//si el token falta, está alterado o expiró, lanza un error de autenticación
import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { GqlExecutionContext } from "@nestjs/graphql";
import { AuthService } from "./auth.service";
import type { RequestContext } from "./types";
import { errorValidacionBackOffice } from "./backoffice-diagnostics";

export type ContextoAutenticado = RequestContext & {
  usuario?: Awaited<ReturnType<AuthService["usuarioActual"]>>;
};

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const gqlContext = GqlExecutionContext.create(context);
    const ctx = gqlContext.getContext<ContextoAutenticado>();

    try {
      ctx.usuario = await this.auth.usuarioActual(ctx);
    } catch (error) {
      if (
        gqlContext.getInfo<{ fieldName: string }>().fieldName ===
        "crearTicketBackOffice"
      ) {
        errorValidacionBackOffice(
          error,
          ctx.req.headers["x-backoffice-request-id"],
        );
      }
      throw error;
    }

    return true;
  }
}
