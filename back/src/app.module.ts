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
import {
  AdminResolver,
  CategoriaAdminResolver,
  EventoEstadoPedidoResolver,
  MovimientoInventarioResolver,
  PagoAdminResolver,
  PagoPedidoResolver,
} from "./admin.resolver";
import { AdminService } from "./admin.service";
import { BackOfficeSubscriptionsResolver } from "./backoffice-subscription.resolver";
import { SubscriptionsResolver } from "./subscription.resolver";
import { EventosService } from "./eventos.service";
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
      subscriptions: { "graphql-ws": { path: "/graphql" } }, //protocolo para subcriptions

      //adaptacion de contexto, motivo:
      //Los guards actuales buscan el token en ctx.req.headers.authorization. Las conexiones envian sus crendciales mediante websockets
      //Demos convertir las credenciales al formato que ya utiliza el backend
      context: ({
        req,
        connectionParams,
      }: {
        req?: RequestContext["req"];
        connectionParams?: Record<string, unknown>;
      }): RequestContext => {
        // Las consultas y mutaciones HTTP conservan su contexto.
        if (req) {
          return { req };
        }

        // Las subscriptions reciben credenciales por WebSocket.
        const authorization = connectionParams?.authorization;

        return {
          req: {
            headers: {
              authorization:
                typeof authorization === "string" ? authorization : undefined,
            },
          },
        };
      },
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
    EventosService,
    BackOfficeSubscriptionsResolver,
  ],
  controllers: [PagosController],
})
export class AppModule {}
