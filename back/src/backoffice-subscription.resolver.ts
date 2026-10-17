import { UseGuards } from "@nestjs/common";
import { Resolver, Subscription } from "@nestjs/graphql";
import { BackOfficeSubscriptionGuard } from "./backoffice-subscription.guard";
import { EventosService } from "./eventos.service";

@Resolver()
export class BackOfficeSubscriptionsResolver {
  constructor(private readonly eventos: EventosService) {}

  @Subscription("backOfficeActualizado")
  @UseGuards(BackOfficeSubscriptionGuard) //se utiliza el guard de backoffice 
  backOfficeActualizado() {
    return this.eventos.escucharBackOffice();
  }
}
