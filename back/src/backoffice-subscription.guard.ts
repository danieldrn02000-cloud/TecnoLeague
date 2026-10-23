import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { GqlExecutionContext } from "@nestjs/graphql";
import { GraphQLError } from "graphql";
import { AuthService } from "./auth.service";
import type { ContextoAutenticado } from "./auth.guard";
import { errorValidacionBackOffice } from "./backoffice-diagnostics";

//Valida el ticket y comprueba que el usuario sea admin
//Conserva el acceso mediante bearer para los srcipts existentes
@Injectable()
export class BackOfficeSubscriptionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const gqlContext = GqlExecutionContext.create(context);
    const ctx = gqlContext.getContext<ContextoAutenticado>();

    if (ctx.subscriptionTicket !== undefined) {
      if (typeof ctx.subscriptionTicket !== "string") {
        throw new GraphQLError("El ticket de administración no es válido.", {
          extensions: { code: "UNAUTHENTICATED" },
        });
      }
      try {
        ctx.usuario = await this.auth.usuarioBackOfficePorTicket(
          ctx.subscriptionTicket,
        );
      } catch (error) {
        errorValidacionBackOffice(
          error,
          ctx.req.headers["x-backoffice-request-id"],
        );
      }
      return true;
    }

    const usuario = await this.auth.usuarioActual(ctx);
    if (usuario.rol !== "ADMIN") {
      throw new GraphQLError(
        "No tienes permiso para realizar esta operación.",
        { extensions: { code: "FORBIDDEN" } },
      );
    }
    ctx.usuario = usuario;
    return true;
  }
}
