import { Injectable } from "@nestjs/common";
import {
  EstadoPago,
  EstadoPedido,
  Prisma,
  TipoMovimientoInventario,
} from "@prisma/client";
import { GraphQLError } from "graphql";
import { PrismaService } from "./prisma.service";
import { fallo } from "./tienda.service";
import { EventosService } from "./eventos.service";

const incluirPedido = {
  detalles: { include: { producto: { include: { categoria: true } } } },
  usuario: true,
} as const;

function validarPagina(limite: number, desde: number) {
  if (
    !Number.isInteger(limite) ||
    limite < 1 ||
    limite > 100 ||
    !Number.isInteger(desde) ||
    desde < 0
  ) {
    fallo("Paginación inválida: límite de 1 a 100 y desde mayor o igual a 0.");
  }
}

function periodo(desde: string, hasta: string) {
  const inicio = new Date(desde);
  const fin = new Date(hasta);
  if (
    !Number.isFinite(inicio.getTime()) ||
    !Number.isFinite(fin.getTime()) ||
    inicio > fin ||
    fin.getTime() - inicio.getTime() > 366 * 86400000
  ) {
    fallo("El periodo de consulta no es válido (máximo 366 días).");
  }
  return { gte: inicio, lte: fin };
}

@Injectable()
export class AdminService {
  constructor(
    private readonly db: PrismaService,
    private readonly eventos: EventosService, //agregamos eventos al constructor
  ) {}

  async dashboard(desde: string, hasta: string) {
    const rango = periodo(desde, hasta);
    const where = { fecha: rango };
    const [
      pedidos,
      pedidosPendientes,
      productosActivos,
      sinExistencias,
      pedidosRecientes,
      movimientosRecientes,
      ventas,
      productosConStockBajo,
    ] = await this.db.$transaction([
      this.db.pedido.count({ where }),
      this.db.pedido.count({
        where: { ...where, status: { in: ["PENDIENTE", "PAGADO"] } },
      }),
      this.db.producto.count({ where: { activo: true } }),
      this.db.producto.count({ where: { activo: true, stock: 0 } }),
      this.db.pedido.findMany({
        orderBy: { fecha: "desc" },
        take: 8,
        include: incluirPedido,
      }),
      this.db.movimientoInventario.findMany({
        orderBy: { creadoEn: "desc" },
        take: 8,
        include: {
          producto: { include: { categoria: true } },
          usuario: {
            select: { id: true, nombre: true, email: true, rol: true },
          },
        },
      }),
      this.db.$queryRaw<{ fecha: string; total: string }[]>`
          SELECT TO_CHAR("fecha" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS fecha,
                COALESCE(SUM("total"), 0)::text AS total
          FROM "pedidos"
          WHERE "fecha" >= ${rango.gte}
            AND "fecha" <= ${rango.lte}
            AND "pedidos"."status"::text <> 'CANCELADO'
            AND (
              ("pedidos"."metodo_pago" = 'PAGO_AL_RECIBIR'
                AND "pedidos"."status"::text = 'ENTREGADO')
              OR EXISTS (
                SELECT 1 FROM "pagos"
                WHERE "pagos"."pedido_id" = "pedidos"."id"
                  AND "pagos"."estado"::text = 'APROBADO'
              )
            )
          GROUP BY 1 ORDER BY 1
        `,
      this.db.$queryRaw<{ count: number }[]>`
          SELECT COUNT(*)::int AS count
          FROM "productos"
          WHERE "activo" = true AND "stock" > 0
            AND "stock" <= "stock_minimo"
        `,
    ]);
    const dias = new Map<string, number>();
    const cursor = new Date(
      Date.UTC(
        rango.gte.getUTCFullYear(),
        rango.gte.getUTCMonth(),
        rango.gte.getUTCDate(),
      ),
    );
    const ultimoDia = new Date(
      Date.UTC(
        rango.lte.getUTCFullYear(),
        rango.lte.getUTCMonth(),
        rango.lte.getUTCDate(),
      ),
    );
    while (cursor <= ultimoDia) {
      dias.set(cursor.toISOString().slice(0, 10), 0);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    let ventasTotales = new Prisma.Decimal(0);
    for (const dia of ventas) {
      dias.set(dia.fecha, Number(dia.total));
      ventasTotales = ventasTotales.plus(dia.total);
    }
    return {
      ventasTotales: Number(ventasTotales),
      totalPedidos: pedidos,
      pedidosPendientes,
      productosActivos,
      stockBajo: productosConStockBajo[0]?.count ?? 0,
      sinExistencias,
      ventasPorDia: [...dias.entries()].map(([fecha, total]) => ({
        fecha,
        total,
      })),
      pedidosRecientes,
      movimientosRecientes,
    };
  }

  async pedidos(
    buscar = "",
    estado?: EstadoPedido,
    metodoPago = "",
    desde = 0,
    limite = 20,
    fechaDesde?: string,
    fechaHasta?: string,
  ) {
    validarPagina(limite, desde);
    const filtro = buscar.trim();
    const folio = /^TL-\d{4}-(\d+)$/i.exec(filtro);
    const idBuscado = folio
      ? Number(folio[1])
      : /^\d+$/.test(filtro)
        ? Number(filtro)
        : null;
    let fechas: Prisma.DateTimeFilter | undefined;
    if (fechaDesde || fechaHasta) {
      const ahora = new Date();
      const inicio = fechaDesde
        ? new Date(`${fechaDesde}T00:00:00.000Z`)
        : new Date(ahora.getTime() - 366 * 86400000);
      const fin = fechaHasta ? new Date(`${fechaHasta}T23:59:59.999Z`) : ahora;
      if (
        !Number.isFinite(inicio.getTime()) ||
        !Number.isFinite(fin.getTime()) ||
        inicio > fin ||
        fin.getTime() - inicio.getTime() > 366 * 86400000
      ) {
        fallo("El periodo de búsqueda no es válido (máximo 366 días).");
      }
      fechas = { gte: inicio, lte: fin };
    }
    const where: Prisma.PedidoWhereInput = {
      ...(fechas ? { fecha: fechas } : {}),
      ...(estado ? { status: estado } : {}),
      ...(metodoPago ? { metodoPago } : {}),
      ...(filtro
        ? {
            OR: [
              { email: { contains: filtro, mode: "insensitive" } },
              { nombre: { contains: filtro, mode: "insensitive" } },
              ...(idBuscado !== null ? [{ id: idBuscado }] : []),
            ],
          }
        : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.pedido.findMany({
        where,
        orderBy: { fecha: "desc" },
        skip: desde,
        take: limite,
        include: incluirPedido,
      }),
      this.db.pedido.count({ where }),
    ]);
    return { items, total };
  }

  async actualizarEstadoPedido(
    id: number,
    nuevoEstado: EstadoPedido,
    actorId: number,
    motivo: string | null = null,
  ) {
    if (!Number.isInteger(id) || id < 1) fallo("Pedido inválido.");
    const motivoLimpio = motivo?.trim() ?? "";
    if (motivoLimpio.length > 300)
      fallo("El motivo no puede superar 300 caracteres.");
    const resultado = await this.db.$transaction(async (tx) => {
      const pedido = await tx.pedido.findUnique({
        where: { id },
        include: { detalles: true, pagos: true },
      });
      if (!pedido) fallo("El pedido no existe.");
      const transiciones: Record<EstadoPedido, EstadoPedido[]> = {
        PENDIENTE: ["ENVIADO", "CANCELADO"],
        PAGADO: ["ENVIADO"],
        ENVIADO: ["ENTREGADO"],
        ENTREGADO: [],
        CANCELADO: [],
      };
      if (!transiciones[pedido.status].includes(nuevoEstado)) {
        fallo(
          `No se permite cambiar el pedido de ${pedido.status} a ${nuevoEstado}.`,
        );
      }
      if (
        nuevoEstado === "ENVIADO" &&
        pedido.status !== "PAGADO" &&
        pedido.metodoPago !== "PAGO_AL_RECIBIR"
      ) {
        fallo(
          "No se puede enviar un pedido cuyo pago en línea no esté aprobado.",
        );
      }
      if (
        nuevoEstado === "CANCELADO" &&
        (pedido.metodoPago !== "PAGO_AL_RECIBIR" || pedido.pagos.length > 0)
      ) {
        fallo(
          "Los pedidos con pago en línea requieren completar su flujo de cancelación o reembolso.",
        );
      }
      const cambio = await tx.pedido.updateMany({
        where: { id, status: pedido.status },
        data: { status: nuevoEstado },
      });
      if (!cambio.count) {
        throw new GraphQLError(
          "El pedido cambió en otra operación. Actualiza la vista.",
          {
            extensions: { code: "CONFLICT" },
          },
        );
      }
      await tx.eventoEstadoPedido.create({
        data: {
          pedidoId: id,
          desde: pedido.status,
          hacia: nuevoEstado,
          actorId,
          motivo: motivoLimpio || null,
        },
      });
      if (nuevoEstado === "CANCELADO") {
        for (const detalle of pedido.detalles) {
          await tx.producto.update({
            where: { id: detalle.productoId },
            data: { stock: { increment: detalle.cantidad } },
          });
          await tx.movimientoInventario.create({
            data: {
              productoId: detalle.productoId,
              usuarioId: actorId,
              pedidoId: pedido.id,
              tipo: "CANCELACION",
              cantidad: detalle.cantidad,
              motivo: `Liberación de inventario por cancelación del pedido ${pedido.id}`,
            },
          });
        }
      }
      return tx.pedido.findUniqueOrThrow({
        where: { id },
        include: incluirPedido,
      });
    });
    //notificacion de pedido actualizado
    await this.eventos.publicarBackOffice({
      entidad: "PEDIDO",
      entidadId: id,
      accion: "ACTUALIZADO",
    });
    if (nuevoEstado === "CANCELADO") {
      //set evita repetir una notificacion para el mismo producto
      for (const productoId of new Set(
        resultado.detalles.map((d) => d.productoId),
      )) {
        await this.eventos.publicarBackOffice({
          entidad: "INVENTARIO",
          entidadId: productoId,
          accion: "ACTUALIZADO",
        });
      }
    }
    return resultado;
  }

  async pedido(id: number) {
    if (!Number.isInteger(id) || id < 1) fallo("Pedido inválido.");
    const pedido = await this.db.pedido.findUnique({
      where: { id },
      include: incluirPedido,
    });
    return pedido ?? fallo("El pedido no existe.");
  }

  async clientes(buscar = "", desde = 0, limite = 20) {
    validarPagina(limite, desde);
    const filtro = buscar.trim();
    const where: Prisma.UsuarioWhereInput = {
      rol: "CLIENTE",
      ...(filtro
        ? {
            OR: [
              { nombre: { contains: filtro, mode: "insensitive" } },
              { email: { contains: filtro, mode: "insensitive" } },
              ...(/^\d+$/.test(filtro) ? [{ id: Number(filtro) }] : []),
            ],
          }
        : {}),
    };
    const [usuarios, total] = await this.db.$transaction([
      this.db.usuario.findMany({
        where,
        select: {
          id: true,
          nombre: true,
          email: true,
          _count: { select: { pedidos: true } },
          pedidos: {
            orderBy: { fecha: "desc" },
            take: 1,
            select: { fecha: true },
          },
        },
        orderBy: { id: "desc" },
        skip: desde,
        take: limite,
      }),
      this.db.usuario.count({ where }),
    ]);
    const ids = usuarios.map((usuario) => usuario.id);
    const totales = ids.length
      ? await this.db.pedido.groupBy({
          by: ["usuarioId"],
          where: {
            usuarioId: { in: ids },
            status: { not: "CANCELADO" },
            OR: [
              {
                metodoPago: "PAGO_AL_RECIBIR",
                status: "ENTREGADO",
              },
              { pagos: { some: { estado: "APROBADO" } } },
            ],
          },
          _sum: { total: true },
        })
      : [];
    const gastos = new Map(
      totales.map((item) => [item.usuarioId, Number(item._sum.total ?? 0)]),
    );
    return {
      items: usuarios.map((usuario) => ({
        id: usuario.id,
        nombre: usuario.nombre,
        email: usuario.email,
        totalPedidos: usuario._count.pedidos,
        gastoConfirmado: gastos.get(usuario.id) ?? 0,
        ultimaCompra: usuario.pedidos[0]?.fecha.toISOString() ?? null,
      })),
      total,
    };
  }

  async cliente(id: number) {
    if (!Number.isInteger(id) || id < 1) fallo("Cliente inválido.");
    const usuario = await this.db.usuario.findFirst({
      where: { id, rol: "CLIENTE" },
      select: {
        id: true,
        nombre: true,
        email: true,
        pedidos: {
          where: {
            status: { not: "CANCELADO" },
            OR: [
              { metodoPago: "PAGO_AL_RECIBIR", status: "ENTREGADO" },
              { pagos: { some: { estado: "APROBADO" } } },
            ],
          },
          orderBy: { fecha: "desc" },
          take: 50,
          include: incluirPedido,
        },
        _count: { select: { pedidos: true } },
      },
    });
    if (!usuario) fallo("El cliente no existe.");
    const totalIngresos = await this.db.pedido.aggregate({
      where: {
        usuarioId: id,
        status: { not: "CANCELADO" },
        OR: [
          { metodoPago: "PAGO_AL_RECIBIR", status: "ENTREGADO" },
          { pagos: { some: { estado: "APROBADO" } } },
        ],
      },
      _sum: { total: true },
    });
    return {
      ...usuario,
      totalPedidos: usuario._count.pedidos,
      gastoConfirmado: Number(totalIngresos._sum.total ?? 0),
      ultimaCompra: usuario.pedidos[0]?.fecha.toISOString() ?? null,
    };
  }

  async pagos(buscar = "", estado?: string, desde = 0, limite = 20) {
    validarPagina(limite, desde);
    const filtro = buscar.trim();
    const estados = [
      "PENDIENTE",
      "APROBADO",
      "RECHAZADO",
      "CANCELADO",
      "REEMBOLSADO",
    ];
    if (estado && !estados.includes(estado))
      fallo("El estado de pago no es válido.");
    const where: Prisma.PagoWhereInput = {
      ...(estado ? { estado: estado as EstadoPago } : {}),
      ...(filtro
        ? {
            OR: [
              { idOrdenExterna: { contains: filtro, mode: "insensitive" } },
              { idPagoExterno: { contains: filtro, mode: "insensitive" } },
              { pedido: { email: { contains: filtro, mode: "insensitive" } } },
              { intento: { email: { contains: filtro, mode: "insensitive" } } },
              { intentoId: { contains: filtro, mode: "insensitive" } },
              ...(/^\d+$/.test(filtro)
                ? [{ id: Number(filtro) }, { pedidoId: Number(filtro) }]
                : []),
            ],
          }
        : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.pago.findMany({
        where,
        include: {
          pedido: {
            select: {
              id: true,
              fecha: true,
              nombre: true,
              email: true,
              status: true,
            },
          },
          intento: { select: { estado: true, ultimoError: true } },
        },
        orderBy: { creadoEn: "desc" },
        skip: desde,
        take: limite,
      }),
      this.db.pago.count({ where }),
    ]);
    return {
      items: items.map((pago) => ({
        ...pago,
        monto: Number(pago.monto),
        estadoIntento: pago.intento?.estado ?? null,
        ultimoError: pago.intento?.ultimoError ?? null,
      })),
      total,
    };
  }

  async movimientos(productoId?: number, desde = 0, limite = 20) {
    validarPagina(limite, desde);
    const where: Prisma.MovimientoInventarioWhereInput = productoId
      ? { productoId }
      : {};
    const [items, total] = await this.db.$transaction([
      this.db.movimientoInventario.findMany({
        where,
        include: {
          producto: { include: { categoria: true } },
          usuario: {
            select: { id: true, nombre: true, email: true, rol: true },
          },
        },
        orderBy: { creadoEn: "desc" },
        skip: desde,
        take: limite,
      }),
      this.db.movimientoInventario.count({ where }),
    ]);
    return { items, total };
  }

  async ajustarInventario(
    productoId: number,
    cantidad: number,
    tipo: TipoMovimientoInventario,
    motivo: string,
    actorId: number,
  ) {
    if (!Number.isInteger(productoId) || productoId < 1)
      fallo("Producto inválido.");
    if (
      !Number.isInteger(cantidad) ||
      cantidad < (tipo === "AJUSTE" ? 0 : 1) ||
      cantidad > 100000
    ) {
      fallo(
        tipo === "AJUSTE"
          ? "La existencia final debe ser un entero entre 0 y 100000."
          : "La cantidad debe ser un entero entre 1 y 100000.",
      );
    }
    if (!["ENTRADA", "SALIDA", "AJUSTE"].includes(tipo)) {
      fallo("Selecciona un tipo de ajuste válido.");
    }
    if (motivo.trim().length < 3 || motivo.length > 300) {
      fallo("Indica un motivo de entre 3 y 300 caracteres.");
    }
    const delta = tipo === "ENTRADA" ? cantidad : -cantidad;
    const resultado = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM productos WHERE id = ${productoId} FOR UPDATE`;
      const actual = await tx.producto.findUnique({
        where: { id: productoId },
      });
      if (!actual || !actual.activo)
        fallo("El producto no existe o está inactivo.");
      const stockNuevo = tipo === "AJUSTE" ? cantidad : actual.stock + delta;
      if (stockNuevo < 0) fallo("La salida supera las existencias actuales.");
      if (stockNuevo > 100000) fallo("El stock máximo es 100000 unidades.");
      const updated = await tx.producto.update({
        where: { id: productoId },
        data: { stock: stockNuevo },
        include: { categoria: true },
      });
      await tx.movimientoInventario.create({
        data: {
          productoId,
          usuarioId: actorId,
          tipo,
          cantidad: stockNuevo - actual.stock,
          motivo: motivo.trim(),
        },
      });
      return updated;
    });

    //notificacion de inventario actualizado
    await this.eventos.publicarBackOffice({
      entidad: "INVENTARIO",
      entidadId: productoId,
      accion: "ACTUALIZADO",
    });

    return resultado;
  }

  async categorias() {
    return this.db.categoria.findMany({
      include: { _count: { select: { productos: true } } },
      orderBy: { nombre: "asc" },
    });
  }

  async crearCategoria(nombre: string) {
    const limpio = nombre.trim();
    if (limpio.length < 2 || limpio.length > 80)
      fallo("El nombre debe tener de 2 a 80 caracteres.");
    try {
      const categoria= await this.db.categoria.create({
        data: { nombre: limpio },
        include: { _count: { select: { productos: true } } },
      });
        //notificacion de categoria creada
      await this.eventos.publicarBackOffice({
        entidad: "CATEGORIA",
        entidadId: categoria.id,
        accion: "CREADO",
    });

    return categoria;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        fallo("Ya existe una categoría con ese nombre.");
      }
      throw error;
    }
  }

  async actualizarCategoria(id: number, nombre: string) {
    const limpio = nombre.trim();
    if (!Number.isInteger(id) || id < 1) fallo("Categoría inválida.");
    if (limpio.length < 2 || limpio.length > 80) {
      fallo("El nombre debe tener de 2 a 80 caracteres.");
    }
    try {
      const categoria= await this.db.categoria.update({
        where: { id },
        data: { nombre: limpio },
        include: { _count: { select: { productos: true } } },
      });
      //notificacion de categoria actualizada
      await this.eventos.publicarBackOffice({
        entidad: "CATEGORIA",
        entidadId: categoria.id,
        accion: "ACTUALIZADO",
    });

    return categoria;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        fallo("Ya existe una categoría con ese nombre.");
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2025"
      ) {
        fallo("La categoría no existe.");
      }
      throw error;
    }
  }

  async eliminarCategoria(id: number) {
    const productos = await this.db.producto.count({
      where: { categoriaId: id },
    });
    if (productos)
      fallo("No se puede eliminar una categoría que contiene productos.");
    try {
      await this.db.categoria.delete({ where: { id } });
      //notificacion de categoria creada
      await this.eventos.publicarBackOffice({
        entidad: "CATEGORIA",
        entidadId: id,
        accion: "ELIMINADO",
    });
      return true;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2025"
      ) {
        fallo("La categoría no existe.");
      }
      throw error;
    }
  }
}
