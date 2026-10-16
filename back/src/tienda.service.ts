import { Injectable, Logger } from "@nestjs/common";
import { EventosService } from "./eventos.service";
import { Prisma } from "@prisma/client";
import { GraphQLError } from "graphql";
import { createHash } from "node:crypto";
import { PrismaService } from "./prisma.service";
import { PedidoInput, ProductoInput } from "./types";

export function fallo(message: string, code = "BAD_USER_INPUT"): never {
  throw new GraphQLError(message, { extensions: { code } });
}
const detallePedido = {
  detalles: { include: { producto: { include: { categoria: true } } } },
  usuario: true,
} as const;

@Injectable()
export class TiendaService {
  private readonly logger = new Logger(TiendaService.name); //Logger permitira registrar un fallo de publicacion sin mostrar datos del pedido
  constructor(
    private readonly db: PrismaService,
    private readonly eventos: EventosService,
  ) {}

  categorias() {
    return this.db.categoria.findMany({
      orderBy: { id: "asc" },
      include: {
        productos: { where: { activo: true }, include: { categoria: true } },
      },
    });
  }
  async categoria(id: number) {
    return (
      (await this.db.categoria.findUnique({
        where: { id },
        include: {
          productos: { where: { activo: true }, include: { categoria: true } },
        },
      })) ?? fallo("La categoría no existe.")
    );
  }
  async productos(
    buscar = "",
    categoriaId?: number,
    limite = 8,
    desde = 0,
    orden = "RECIENTES",
  ) {
    if (limite < 1 || limite > 100 || desde < 0)
      fallo(
        "Paginación inválida: límite de 1 a 100 y desde mayor o igual a 0.",
      );
    const where: Prisma.ProductoWhereInput = {
      activo: true,
      ...(categoriaId ? { categoriaId } : {}),
      ...(buscar.trim()
        ? {
            OR: [
              { nombre: { contains: buscar.trim(), mode: "insensitive" } },
              { marca: { contains: buscar.trim(), mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const orderBy: Prisma.ProductoOrderByWithRelationInput[] =
      orden === "PRECIO_ASC"
        ? [{ precio: "asc" }, { id: "asc" }]
        : orden === "PRECIO_DESC"
          ? [{ precio: "desc" }, { id: "asc" }]
          : [{ id: "asc" }];
    const [items, total] = await this.db.$transaction([
      this.db.producto.findMany({
        where,
        include: { categoria: true },
        take: limite,
        skip: desde,
        orderBy,
      }),
      this.db.producto.count({ where }),
    ]);
    return { items, total };
  }

  async producto(id: number) {
    return (
      (await this.db.producto.findFirst({
        where: { id, activo: true },
        include: { categoria: true },
      })) ?? fallo("El producto ya no está disponible.")
    );
  }
  pedidos(usuarioId: number) {
    return this.db.pedido.findMany({
      where: { usuarioId },
      orderBy: { fecha: "desc" },
      include: detallePedido,
    });
  }

  async validarProducto(datos: ProductoInput) {
    if (!datos.nombre.trim() || datos.nombre.length > 120)
      fallo("Escribe un nombre de hasta 120 caracteres.");
    if (!datos.descripcion.trim() || datos.descripcion.length > 2000)
      fallo("La descripción debe tener entre 1 y 2000 caracteres.");
    if (
      !Number.isFinite(datos.precio) ||
      datos.precio <= 0 ||
      datos.precio > 999999.99 ||
      Math.abs(datos.precio * 100 - Math.round(datos.precio * 100)) > 0.000001
    )
      fallo("El precio debe ser positivo y tener como máximo dos decimales.");
    if (
      !Number.isInteger(datos.stock) ||
      datos.stock < 0 ||
      datos.stock > 100000
    )
      fallo("Stock inválido.");
    if (
      !Number.isInteger(datos.stockMinimo) ||
      datos.stockMinimo < 0 ||
      datos.stockMinimo > 100000
    )
      fallo("El nivel mínimo de existencias debe estar entre 0 y 100000.");
    if (
      !datos.marca.trim() ||
      datos.marca.length > 80 ||
      datos.especificaciones.length > 2000
    )
      fallo("Revisa la marca y las especificaciones.");
    if (
      !/^\/images\/[a-zA-Z0-9._-]+$/.test(datos.imagen) &&
      !/^https:\/\//.test(datos.imagen)
    )
      fallo("La imagen debe ser /images/archivo o una URL HTTPS.");
    if (datos.imagen.length > 1000)
      fallo("La dirección de imagen es demasiado larga.");
    if (
      !(await this.db.categoria.findUnique({
        where: { id: datos.categoriaId },
      }))
    )
      fallo("Selecciona una categoría válida.");
    return {
      ...datos,
      nombre: datos.nombre.trim(),
      marca: datos.marca.trim(),
      precio: new Prisma.Decimal(datos.precio.toFixed(2)),
    };
  }

  //cambios para las notificaciones de tal manera que se puedan publicar altas, modificaciones y bajas de productos
  async crearProducto(datos: ProductoInput, actorId: number) {
    const producto = await this.validarProducto(datos);
    const resultado = await this.db.$transaction(async (tx) => {
      const creado = await tx.producto.create({
        data: producto,
        include: { categoria: true },
      });
      if (creado.stock > 0) {
        await tx.movimientoInventario.create({
          data: {
            productoId: creado.id,
            usuarioId: actorId,
            tipo: "INICIAL",
            cantidad: creado.stock,
            motivo: "Existencia inicial al crear el producto",
          },
        });
      }
      return creado;
    });
    await this.eventos.publicarBackOffice({
      entidad: "PRODUCTO",
      entidadId: resultado.id,
      accion: "CREADO",
    });
    if (resultado.stock > 0)
      await this.eventos.publicarBackOffice({
        entidad: "INVENTARIO",
        entidadId: resultado.id,
        accion: "ACTUALIZADO",
      });
    return resultado;
  }

  async actualizarProducto(id: number, datos: ProductoInput) {
    await this.producto(id);
    const validado = await this.validarProducto(datos);
    const resultado = await this.db.producto.update({
      where: { id },
      data: {
        nombre: validado.nombre,
        descripcion: validado.descripcion,
        precio: validado.precio,
        imagen: validado.imagen,
        stockMinimo: validado.stockMinimo,
        marca: validado.marca,
        especificaciones: validado.especificaciones,
        categoriaId: validado.categoriaId,
      },
      include: { categoria: true },
    });

    //notificacion de producto actualizado
    await this.eventos.publicarBackOffice({
      entidad: "PRODUCTO",
      entidadId: id,
      accion: "ACTUALIZADO",
    });

    return resultado;
  }

  async eliminarProducto(id: number) {
    await this.producto(id);
    // Baja lógica: un pedido antiguo debe conservar su relación con el producto.
    await this.db.producto.update({ where: { id }, data: { activo: false } });
    //notificacion de producto desactivado
    await this.eventos.publicarBackOffice({
      entidad: "PRODUCTO",
      entidadId: id,
      accion: "DESACTIVADO",
    });

    return true;
  }

  async crearPedido(datos: PedidoInput, usuarioId: number) {
    if (datos.nombre.trim().length < 2 || datos.nombre.length > 120)
      fallo("Escribe tu nombre completo.");
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.email) ||
      datos.email.length > 150
    )
      fallo("El correo no es válido.");
    if (datos.direccion.trim().length < 10 || datos.direccion.length > 500)
      fallo("Escribe una dirección completa (10 a 500 caracteres).");
    if (!/^[0-9a-f-]{36}$/i.test(datos.claveSolicitud))
      fallo("Identificador de pedido inválido.");
    if (!datos.renglones.length || datos.renglones.length > 50)
      fallo("El carrito debe contener de 1 a 50 renglones.");
    const cantidades = new Map<number, number>();
    for (const linea of datos.renglones) {
      if (
        !Number.isInteger(linea.cantidad) ||
        linea.cantidad < 1 ||
        linea.cantidad > 99
      )
        fallo("Las cantidades deben estar entre 1 y 99.");
      cantidades.set(
        linea.productoId,
        (cantidades.get(linea.productoId) ?? 0) + linea.cantidad,
      );
    }
    if ([...cantidades.values()].some((n) => n > 99))
      fallo("Máximo 99 unidades de un mismo producto.");
    const renglones = [...cantidades.entries()].sort((a, b) => a[0] - b[0]);
    const huellaSolicitud = createHash("sha256")
      .update(
        JSON.stringify({
          usuarioId,
          nombre: datos.nombre.trim(),
          email: datos.email.trim().toLowerCase(),
          direccion: datos.direccion.trim(),
          renglones,
        }),
      )
      .digest("hex");
    const existente = await this.db.pedido.findUnique({
      where: { claveSolicitud: datos.claveSolicitud },
      include: detallePedido,
    });
    if (existente) {
      if (existente.huellaSolicitud !== huellaSolicitud)
        fallo("La solicitud ya se utilizó con otros datos.");
      return existente;
    }
    try {
      // Todo ocurre en una transacción: si falla un renglón, no se descuenta nada.
      const pedidoCreado = await this.db.$transaction(
        async (tx) => {
          let total = new Prisma.Decimal(0);
          const detalles: {
            productoId: number;
            cantidad: number;
            precioUnitario: Prisma.Decimal;
            nombreProducto: string;
          }[] = [];
          for (const [productoId, cantidad] of renglones) {
            // UPDATE condicional y atómico: también evita sobreventa entre dos compras simultáneas.
            const cambio = await tx.producto.updateMany({
              where: { id: productoId, activo: true, stock: { gte: cantidad } },
              data: { stock: { decrement: cantidad } },
            });
            if (!cambio.count)
              fallo(
                `El producto ${productoId} ya no tiene stock suficiente. Actualiza el carrito.`,
              );
            const producto = await tx.producto.findUniqueOrThrow({
              where: { id: productoId },
            });
            total = total.plus(producto.precio.mul(cantidad));
            detalles.push({
              productoId,
              cantidad,
              precioUnitario: producto.precio,
              nombreProducto: producto.nombre,
            });
          }
          const pedido = await tx.pedido.create({
            data: {
              usuarioId,
              nombre: datos.nombre.trim(),
              email: datos.email.trim().toLowerCase(),
              direccion: datos.direccion.trim(),
              claveSolicitud: datos.claveSolicitud,
              huellaSolicitud,
              total,
              detalles: { create: detalles },
            },
            include: detallePedido,
          });
          await tx.movimientoInventario.createMany({
            data: detalles.map((detalle) => ({
              productoId: detalle.productoId,
              usuarioId,
              pedidoId: pedido.id,
              tipo: "PEDIDO",
              cantidad: -detalle.cantidad,
              motivo: `Salida por pedido ${pedido.id}`,
            })),
          });
          await tx.eventoEstadoPedido.create({
            data: {
              pedidoId: pedido.id,
              actorId: usuarioId,
              hacia: "PENDIENTE",
              motivo: "Pedido creado",
            },
          });
          return pedido;
        },
        { maxWait: 10000, timeout: 15000 },
      );
      //try catch de publicacion, evita que se mezclen errores
      try {
        await this.eventos.publicarBackOffice({
          entidad: "PEDIDO",
          entidadId: pedidoCreado.id,
          accion: "CREADO",
        });
      } catch {
        this.logger.error(
          "El pedido fue confirmado, pero no se pudo publicar su evento.",
        );
      }

      //notificacion de pedido creado
      for (const [productoId] of renglones) {
        await this.eventos.publicarBackOffice({
          entidad: "INVENTARIO",
          entidadId: productoId,
          accion: "ACTUALIZADO",
        });
      }

      return pedidoCreado;
    } catch (error) {
      // Reintentar una misma compra no genera dos pedidos ni descuenta stock dos veces.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const pedido = await this.db.pedido.findUniqueOrThrow({
          where: { claveSolicitud: datos.claveSolicitud },
          include: detallePedido,
        });
        if (pedido.huellaSolicitud !== huellaSolicitud)
          fallo("La solicitud ya se utilizó con otros datos.");
        return pedido;
      }
      throw error;
    }
  }
}
