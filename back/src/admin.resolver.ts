import { UseGuards } from "@nestjs/common";
import {
  Args,
  Context,
  Mutation,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from "@nestjs/graphql";
import { EstadoPago, EstadoPedido, TipoMovimientoInventario } from "@prisma/client";
import { GraphQLError } from "graphql";
import { AuthGuard } from "./auth.guard";
import { RolesGuard } from "./roles.guard";
import { Roles } from "./roles.decorator";
import { AdminService } from "./admin.service";
import { PrismaService } from "./prisma.service";
import { AuthService } from "./auth.service";
import type { RequestContext } from "./types";

function actorId(ctx: RequestContext) {
  if (!ctx.usuario) {
    throw new GraphQLError("Inicia sesión para continuar.", {
      extensions: { code: "UNAUTHENTICATED" },
    });
  }
  return ctx.usuario.id;
}

@Resolver()
@UseGuards(AuthGuard, RolesGuard)
@Roles("ADMIN")
export class AdminResolver {
  constructor(
    private readonly admin: AdminService,
    private readonly db: PrismaService,
    private readonly auth: AuthService,
  ) {}

  //agrega la mutacion crearTicketBackOffice, protegia por los permisos adminisitrativos existentes
  @Mutation("crearTicketBackOffice")
  crearTicketBackOffice(@Context() ctx: RequestContext) {
    return this.auth.crearTicketBackOffice(actorId(ctx));
  }

  @Query("adminDashboard")
  dashboard(@Args("desde") desde: string, @Args("hasta") hasta: string) {
    return this.admin.dashboard(desde, hasta);
  }

  @Query("adminPedidos")
  pedidos(
    @Args("buscar") buscar: string,
    @Args("estado") estado: EstadoPedido | undefined,
    @Args("metodoPago") metodoPago: string,
    @Args("desde") desde: number,
    @Args("limite") limite: number,
    @Args("fechaDesde") fechaDesde: string | undefined,
    @Args("fechaHasta") fechaHasta: string | undefined,
  ) {
    return this.admin.pedidos(
      buscar,
      estado,
      metodoPago,
      desde,
      limite,
      fechaDesde,
      fechaHasta,
    );
  }

  @Query("adminPedido")
  pedido(@Args("id") id: number) {
    return this.admin.pedido(id);
  }

  @Query("historialPedido")
  historialPedido(@Args("id") id: number) {
    return this.db.eventoEstadoPedido.findMany({
      where: { pedidoId: id },
      include: { actor: { select: { id: true, nombre: true } } },
      orderBy: { creadoEn: "desc" },
    });
  }

  @Query("adminClientes")
  clientes(
    @Args("buscar") buscar: string,
    @Args("desde") desde: number,
    @Args("limite") limite: number,
  ) {
    return this.admin.clientes(buscar, desde, limite);
  }

  @Query("adminCliente")
  cliente(@Args("id") id: number) {
    return this.admin.cliente(id);
  }

  @Query("adminPagos")
  pagos(
    @Args("buscar") buscar: string,
    @Args("estado") estado: EstadoPago | undefined,
    @Args("desde") desde: number,
    @Args("limite") limite: number,
  ) {
    return this.admin.pagos(buscar, estado, desde, limite);
  }

  @Query("adminMovimientos")
  movimientos(
    @Args("productoId") productoId: number | undefined,
    @Args("desde") desde: number,
    @Args("limite") limite: number,
  ) {
    return this.admin.movimientos(productoId, desde, limite);
  }

  @Query("adminCategorias")
  categorias() {
    return this.admin.categorias();
  }

  @Mutation("actualizarEstadoPedido")
  actualizarEstadoPedido(
    @Args("id") id: number,
    @Args("estado") estado: EstadoPedido,
    @Args("motivo") motivo: string | undefined,
    @Context() ctx: RequestContext,
  ) {
    return this.admin.actualizarEstadoPedido(id, estado, actorId(ctx), motivo);
  }

  @Mutation("ajustarInventario")
  ajustarInventario(
    @Args("productoId") productoId: number,
    @Args("cantidad") cantidad: number,
    @Args("tipo") tipo: TipoMovimientoInventario,
    @Args("motivo") motivo: string,
    @Context() ctx: RequestContext,
  ) {
    return this.admin.ajustarInventario(productoId, cantidad, tipo, motivo, actorId(ctx));
  }

  @Mutation("crearCategoria")
  crearCategoria(@Args("nombre") nombre: string) {
    return this.admin.crearCategoria(nombre);
  }

  @Mutation("actualizarCategoria")
  actualizarCategoria(
    @Args("id") id: number,
    @Args("nombre") nombre: string,
  ) {
    return this.admin.actualizarCategoria(id, nombre);
  }

  @Mutation("eliminarCategoria")
  eliminarCategoria(@Args("id") id: number) {
    return this.admin.eliminarCategoria(id);
  }
}

@Resolver("EventoEstadoPedido")
@UseGuards(AuthGuard, RolesGuard)
@Roles("ADMIN")
export class EventoEstadoPedidoResolver {
  @ResolveField("creadoEn")
  creadoEn(@Parent() evento: { creadoEn: Date }) {
    return evento.creadoEn.toISOString();
  }
}

@Resolver("MovimientoInventario")
@UseGuards(AuthGuard, RolesGuard)
@Roles("ADMIN")
export class MovimientoInventarioResolver {
  @ResolveField("creadoEn")
  creadoEn(@Parent() movimiento: { creadoEn: Date }) {
    return movimiento.creadoEn.toISOString();
  }
}

@Resolver("CategoriaAdmin")
@UseGuards(AuthGuard, RolesGuard)
@Roles("ADMIN")
export class CategoriaAdminResolver {
  @ResolveField("productosCount")
  productosCount(@Parent() categoria: { _count: { productos: number } }) {
    return categoria._count.productos;
  }
}

@Resolver("PagoAdmin")
@UseGuards(AuthGuard, RolesGuard)
@Roles("ADMIN")
export class PagoAdminResolver {
  @ResolveField("creadoEn")
  creadoEn(@Parent() pago: { creadoEn: Date }) {
    return pago.creadoEn.toISOString();
  }
  @ResolveField("aprobadoEn")
  aprobadoEn(@Parent() pago: { aprobadoEn: Date | null }) {
    return pago.aprobadoEn?.toISOString() ?? null;
  }
}

@Resolver("PagoPedido")
@UseGuards(AuthGuard, RolesGuard)
@Roles("ADMIN")
export class PagoPedidoResolver {
  @ResolveField("fecha")
  fecha(@Parent() pedido: { fecha: Date }) {
    return pedido.fecha.toISOString();
  }
}
