import { UseGuards } from "@nestjs/common";
import { Args, Mutation, Query, Resolver } from "@nestjs/graphql";
import { AuthGuard } from "./auth.guard";
import { RolesGuard } from "./roles.guard";
import { Roles } from "./roles.decorator";
import { PrismaService } from "./prisma.service";
import { fallo } from "./tienda.service";

type TextoGuia = { clave: string; texto: string };

@Resolver()
export class GuiaGamerResolver {
  constructor(private readonly db: PrismaService) {}

  @Query("guiaGamer")
  async leer() {
    return this.db.guiaGamer.findUniqueOrThrow({ where: { id: 1 } });
  }

  @Mutation("guardarGuiaGamer")
  @UseGuards(AuthGuard, RolesGuard)
  @Roles("ADMIN")
  async guardar(
    @Args("revision") revision: number,
    @Args("textos") textos: TextoGuia[],
  ) {
    if (textos.length > 200) fallo("La guía contiene demasiados cambios.");
    const claves = new Set<string>();
    let longitud = 0;
    const cambios = textos.map(({ clave, texto }) => {
      const valor = texto.trim();
      if (!/^[a-z][a-z0-9.]{0,63}$/.test(clave) || claves.has(clave))
        fallo("Hay un campo de la guía inválido o repetido.");
      if (!valor || valor.length > 2000 || valor.includes("\0"))
        fallo("Cada texto debe tener de 1 a 2000 caracteres válidos.");
      claves.add(clave);
      longitud += valor.length;
      return { clave, texto: valor };
    });
    if (longitud > 45000) fallo("El contenido de la guía supera el tamaño permitido.");
    const resultado = await this.db.guiaGamer.updateMany({
      where: { id: 1, revision },
      data: { textos: cambios, revision: { increment: 1 } },
    });
    if (!resultado.count)
      fallo("Otra persona guardó cambios. Vuelve a abrir el editor antes de guardar.", "CONFLICT");
    return { revision: revision + 1, textos: cambios };
  }
}
