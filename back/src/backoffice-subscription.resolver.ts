import { UseGuards } from "@nestjs/common";
import { Context, Resolver, Subscription } from "@nestjs/graphql";
import { GraphQLError } from "graphql";
import { BackOfficeSubscriptionGuard } from "./backoffice-subscription.guard";
import { EventosService } from "./eventos.service";
import { PrismaService } from "./prisma.service";
import type { ContextoAutenticado } from "./auth.guard";

@Resolver()
export class BackOfficeSubscriptionsResolver {
  constructor(
    private readonly eventos: EventosService,
    private readonly db: PrismaService,
  ) {}

  @Subscription("backOfficeActualizado")
  @UseGuards(BackOfficeSubscriptionGuard) //se utiliza el guard de backoffice 
  backOfficeActualizado(@Context() ctx: ContextoAutenticado) {
    const id = ctx.usuario!.id; // El guard ya validó al administrador.
    const eventos = this.eventos.escucharBackOffice();
    const db = this.db;
    return {
      async next() {
        const evento = await eventos.next();
        if (evento.done) return evento;
        try {
          const cuenta = await db.usuario.findUnique({
            where: { id },
            select: { rol: true },
          });
          if (cuenta?.rol !== "ADMIN")
            throw new GraphQLError("Tu cuenta ya no tiene acceso administrativo.", {
              extensions: { code: "FORBIDDEN" },
            });
          return evento;
        } catch (error) {
          await eventos.return?.();
          throw error;
        }
      },
      return: eventos.return?.bind(eventos),
      throw: eventos.throw?.bind(eventos),
      [Symbol.asyncIterator]() { return this; },
    };
  }
}
