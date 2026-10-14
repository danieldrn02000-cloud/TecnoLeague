import { PagosService } from "./pagos.service";
import { PagosResolver } from "./pagos.resolver";
import { Module } from "@nestjs/common";
import { GraphQLModule } from "@nestjs/graphql";
import { ApolloDriver, ApolloDriverConfig } from "@nestjs/apollo";
import { join } from "node:path";
import { PrismaService } from "./prisma.service";
import { AuthService } from "./auth.service";
import { TiendaService } from "./tienda.service";
import { JwtModule } from "@nestjs/jwt";
import { PagosController } from "./pagos.controller";
import { AdminResolver, CategoriaAdminResolver, EventoEstadoPedidoResolver, MovimientoInventarioResolver, PagoAdminResolver, PagoPedidoResolver } from "./admin.resolver";
import { AdminService } from "./admin.service";
import {SubscriptionsResolver} from "./subscription.resolver";
import type { RequestContext } from "./types";

import {
  AuthResolver,
  TiendaResolver,
  ProductoResolver,
  CategoriaResolver,
  PedidoResolver,
  DetalleResolver,
  UsuarioResolver,
} from "./tienda.resolver";


@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      typePaths: [join(__dirname, "schema.graphql")],
      path: "/graphql",
      graphiql: true,
      introspection: true,
      subscriptions:{"graphql-ws":{path: "/graphql"}}, //protocolo para subcriptions
      context: ({ req }: { req: RequestContext["req"] }) => ({ req }),
    }),
    JwtModule.registerAsync({
  useFactory: () => {
    const secret = process.env.JWT_SECRET;

    if (!secret) {
      throw new Error("Falta JWT_SECRET en el .env del backend.");
    }

    return { secret };
  },
}),
  ],
  providers: [
    PagosService,
    PagosResolver,
    AdminService,
    AdminResolver,
    CategoriaAdminResolver,
    EventoEstadoPedidoResolver,
    MovimientoInventarioResolver,
    PagoAdminResolver,
    PagoPedidoResolver,
    PrismaService,
    AuthService,
    TiendaService,
    AuthResolver,
    TiendaResolver,
    ProductoResolver,
    CategoriaResolver,
    PedidoResolver,
    DetalleResolver,
    UsuarioResolver,
    SubscriptionsResolver,
  ],
  controllers: [PagosController],
})
export class AppModule {}
