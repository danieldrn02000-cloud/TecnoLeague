//este archivo conexta el campo graphql con el servicio central
//Tambien aplica permisos administrativos.
//Se separa del resolver temporal para mantener claras sus responsabilidades
import { UseGuards } from "@nestjs/common";
import { Resolver, Subscription } from "@nestjs/graphql";
import { AuthGuard } from "./auth.guard";
import { RolesGuard } from "./roles.guard";
import { Roles } from "./roles.decorator";
import { EventosService } from "./eventos.service";

@Resolver()
@UseGuards(AuthGuard, RolesGuard)
@Roles("ADMIN")
export class BackOfficeSubscriptionsResolver {
  constructor(
    private readonly eventos: EventosService,
  ) {}

  @Subscription("backOfficeActualizado")
  backOfficeActualizado() {
    return this.eventos.escucharBackOffice();
  }
}