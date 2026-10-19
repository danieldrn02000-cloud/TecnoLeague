import { Args, Context, Mutation, Query, Resolver } from "@nestjs/graphql";
import { AuthService } from "./auth.service";
import { PagosService } from "./pagos.service";
import type { DatosPagoInput, PedidoInput, RequestContext } from "./types";

@Resolver()
export class PagosResolver {
  constructor(
    private readonly pagos: PagosService,
    private readonly auth: AuthService,
  ) {}
  //mutatios preparar compra y procesar compra
  @Mutation("prepararCompra")
  async prepararCompra(
    @Args("datos") datos: PedidoInput,
    @Context() ctx: RequestContext,
  ) {
    return this.pagos.prepararCompra(
      datos,
      (await this.auth.usuarioActual(ctx)).id,
    );
  }

  @Mutation("procesarPago")
  async procesarPago(
    @Args("intentoId") intentoId: string,
    @Args("datosPago") datos: DatosPagoInput,
    @Context() ctx: RequestContext,
  ) {
    return this.pagos.procesarPago(
      intentoId,
      datos,
      (await this.auth.usuarioActual(ctx)).id,
    );
  }
  
  @Mutation("iniciarPago")
  async iniciarPago(
    @Args("datos") datos: PedidoInput,
    @Context() ctx: RequestContext,
  ) {
    const usuario = await this.auth.usuarioActual(ctx);
    return this.pagos.iniciarPago(datos, usuario.id);
  }

  @Query("intentoActivo")
  async intentoActivo(@Context() ctx: RequestContext) {
    return this.pagos.intentoActivo((await this.auth.usuarioActual(ctx)).id);
  }

  @Mutation("cancelarIntento")
  async cancelarIntento(
    @Args("intentoId") intentoId: string,
    @Context() ctx: RequestContext,
  ) {
    return this.pagos.cancelarIntento(
      intentoId,
      (await this.auth.usuarioActual(ctx)).id,
    );
  }

  @Query("estadoIntento")
  async estadoIntento(
    @Args("intentoId") intentoId: string,
    @Context() ctx: RequestContext,
  ) {
    const usuario = await this.auth.usuarioActual(ctx);
    return this.pagos.consultarIntento(intentoId, usuario.id);
  }
}
