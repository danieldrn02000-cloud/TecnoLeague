import { UseGuards } from "@nestjs/common";
import { AuthGuard } from "./auth.guard";
import { RolesGuard } from "./roles.guard";
import { Roles } from "./roles.decorator";
import {
  Args,
  Context,
  Mutation,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from "@nestjs/graphql";
import {
  Categoria,
  DetallePedido,
  Pedido,
  Producto,
  Usuario,
} from "@prisma/client";
import { PrismaService } from "./prisma.service";
import { AuthService } from "./auth.service";
import { TiendaService } from "./tienda.service";
import {
  CredencialesInput,
  PedidoInput,
  ProductoInput,
  RegistroInput,
  RequestContext,
} from "./types";
import { GraphQLError } from "graphql";

function exigirPuenteAuth(ctx: RequestContext) {
  const secreto = process.env.AUTH_BRIDGE_SECRET;
  const recibido = ctx.req.headers["x-auth-bridge-secret"];
  if (!secreto || recibido !== secreto) {
    throw new GraphQLError(
      "La autenticación solo está disponible a través del servidor web.",
      { extensions: { code: "FORBIDDEN" } },
    );
  }
}

function obtenerUsuario(ctx: RequestContext) {
  if (!ctx.usuario) {
    throw new GraphQLError("Inicia sesión para continuar.", {
      extensions: { code: "UNAUTHENTICATED" },
    });
  }
  return ctx.usuario;
}

@Resolver()
export class AuthResolver {
  constructor(private readonly auth: AuthService) {}

  @Mutation("registrarUsuario") registrarUsuario(
    @Args("datos") datos: RegistroInput,
    @Context() ctx: RequestContext,
  ) {
    exigirPuenteAuth(ctx);
    return this.auth.registrar(datos);
  }

  @Mutation("iniciarSesion") iniciarSesion(
    @Args("datos") datos: CredencialesInput,
    @Context() ctx: RequestContext,
  ) {
    exigirPuenteAuth(ctx);
    return this.auth.iniciarSesion(datos);
  }


  @Query("usuarioActual")
  @UseGuards(AuthGuard)
  usuarioActual(@Context() ctx: RequestContext) {
    return obtenerUsuario(ctx);
  }
}

@Resolver()
export class TiendaResolver {
  constructor(
    private readonly tienda: TiendaService,
  ) {}
  @Query("categorias") categorias() {
    return this.tienda.categorias();
  }
  @Query("categoria") categoria(@Args("id") id: number) {
    return this.tienda.categoria(id);
  }
  @Query("productos") productos(
    @Args("buscar") buscar: string,
    @Args("categoriaId") categoriaId: number,
    @Args("limite") limite: number,
    @Args("desde") desde: number,
    @Args("orden") orden: string,
  ) {
    return this.tienda.productos(buscar, categoriaId, limite, desde, orden);
  }
  @Query("producto") producto(@Args("id") id: number) {
    return this.tienda.producto(id);
  }
  @Query("pedidos")
  @UseGuards(AuthGuard)
  pedidos(@Context() ctx: RequestContext) {
    const usuario = obtenerUsuario(ctx);
    return this.tienda.pedidos(usuario.id);
  }
  @Query("verificarAdmin")
  @UseGuards(AuthGuard, RolesGuard)
  @Roles("ADMIN")
  verificarAdmin() {
    return true;
  }
  @Mutation("crearProducto")
  @UseGuards(AuthGuard, RolesGuard)
  @Roles("ADMIN")
  crearProducto(
    @Args("datos") datos: ProductoInput,
    @Context() ctx: RequestContext,
  ) {
    return this.tienda.crearProducto(datos, obtenerUsuario(ctx).id);
  }
  @Mutation("actualizarProducto")
  @UseGuards(AuthGuard, RolesGuard)
  @Roles("ADMIN")
  actualizarProducto(
    @Args("id") id: number,
    @Args("datos") datos: ProductoInput,
  ) {
    return this.tienda.actualizarProducto(id, datos);
  }
  @Mutation("eliminarProducto")
  @UseGuards(AuthGuard, RolesGuard)
  @Roles("ADMIN")
  eliminarProducto(
    @Args("id") id: number,
  ) {
    return this.tienda.eliminarProducto(id);
  }
  @Mutation("crearPedido")
  @UseGuards(AuthGuard)
  crearPedido(
    @Args("datos") datos: PedidoInput,
    @Context() ctx: RequestContext,
  ) {
    const usuario = obtenerUsuario(ctx);
    return this.tienda.crearPedido(datos, usuario.id);
  }
}

@Resolver("Producto")
export class ProductoResolver {
  constructor(private readonly db: PrismaService) {}
  @ResolveField("categoria") categoria(
    @Parent() p: Producto & { categoria?: Categoria },
  ) {
    return (
      p.categoria ??
      this.db.categoria.findUnique({ where: { id: p.categoriaId } })
    );
  }
  @ResolveField("precio") precio(@Parent() p: Producto) {
    return Number(p.precio);
  }
}
@Resolver("Categoria")
export class CategoriaResolver {
  constructor(private readonly db: PrismaService) {}
  @ResolveField("productos") productos(
    @Parent() c: Categoria & { productos?: Producto[] },
  ) {
    return (
      c.productos ??
      this.db.producto.findMany({
        where: { categoriaId: c.id, activo: true },
        include: { categoria: true },
      })
    );
  }
}
@Resolver("Pedido")
export class PedidoResolver {
  constructor(private readonly db: PrismaService) {}
  @ResolveField("estadoPago")
  async estadoPago(@Parent() pedido: Pedido & { pagos?: { estado: string }[] }) {
    const pagos =
      pedido.pagos ??
      (await this.db.pago.findMany({
        where: { pedidoId: pedido.id },
        select: { estado: true },
        orderBy: { actualizadoEn: "desc" },
      }));
    if (pagos.some((pago) => pago.estado === "REEMBOLSADO")) return "REEMBOLSADO";
    if (pagos.some((pago) => pago.estado === "APROBADO")) return "APROBADO";
    if (pagos.some((pago) => pago.estado === "RECHAZADO")) return "RECHAZADO";
    if (pagos.some((pago) => pago.estado === "CANCELADO")) return "CANCELADO";
    return "PENDIENTE";
  }
  @ResolveField("folio") folio(@Parent() p: Pedido) {
    return `TL-${p.fecha.getFullYear()}-${String(p.id).padStart(4, "0")}`;
  }
  @ResolveField("fecha") fecha(@Parent() p: Pedido) {
    return p.fecha.toISOString();
  }
  @ResolveField("total") total(@Parent() p: Pedido) {
    return Number(p.total);
  }
  @ResolveField("usuario") usuario(
    @Parent() p: Pedido & { usuario?: Usuario },
  ) {
    return (
      p.usuario ?? this.db.usuario.findUnique({ where: { id: p.usuarioId } })
    );
  }
  @ResolveField("detalles") detalles(
    @Parent() p: Pedido & { detalles?: DetallePedido[] },
  ) {
    return (
      p.detalles ??
      this.db.detallePedido.findMany({
        where: { pedidoId: p.id },
        include: { producto: { include: { categoria: true } } },
      })
    );
  }
}
@Resolver("DetallePedido")
export class DetalleResolver {
  constructor(private readonly db: PrismaService) {}
  @ResolveField("producto") producto(
    @Parent() d: DetallePedido & { producto?: Producto },
  ) {
    return (
      d.producto ??
      this.db.producto.findUnique({
        where: { id: d.productoId },
        include: { categoria: true },
      })
    );
  }
  @ResolveField("precioUnitario") precio(@Parent() d: DetallePedido) {
    return Number(d.precioUnitario);
  }
  @ResolveField("subtotal") subtotal(@Parent() d: DetallePedido) {
    return Number(d.precioUnitario.mul(d.cantidad));
  }
}
@Resolver("Usuario")
export class UsuarioResolver {
  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthService,
  ) {}
  @ResolveField("pedidos")
  async pedidos(@Parent() u: Usuario, @Context() ctx: RequestContext) {
    const actual = await this.auth.usuarioActual(ctx);
    if (actual.id !== u.id) {
      throw new GraphQLError("No puedes consultar los pedidos de otra cuenta.", {
        extensions: { code: "FORBIDDEN" },
      });
    }
    return this.db.pedido.findMany({
      where: { usuarioId: u.id },
      include: {
        detalles: { include: { producto: { include: { categoria: true } } } },
      },
    });
  }
}
