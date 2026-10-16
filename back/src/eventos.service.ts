//Este archivo concentra la publicacion y escucha de evento en un unico proveedor de NestJS.
//Los demás servicios utilizarán los métodos de esta clase, sin manipular directamente pubSub
import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PubSub } from "graphql-subscriptions";

//evitan publicar nombres de entidades o acciones equivocados
export type EntidadBackOffice =
  | "PEDIDO"
  | "PRODUCTO"
  | "INVENTARIO"
  | "CATEGORIA"
  | "PAGO";

export type AccionBackOffice =
  | "CREADO"
  | "ACTUALIZADO"
  | "DESACTIVADO"
  | "ELIMINADO";

export interface EventoBackOffice {
  eventoId: string; //identifica cad notificacion
  entidad: EntidadBackOffice; 
  entidadId: number; //permite consultar despues el registro modificado
  accion: AccionBackOffice;
  ocurridoEn: string;
}

export interface PayloadBackOffice {
  backOfficeActualizado: EventoBackOffice;
}

type NuevoEventoBackOffice = Pick<
  EventoBackOffice,
  "entidad" | "entidadId" | "accion"
>;

const CANAL_BACKOFFICE = "BACKOFFICE_ACTUALIZADO";

@Injectable()
export class EventosService {
  private readonly logger = new Logger(EventosService.name);

  private readonly pubSub = new PubSub<{
    BACKOFFICE_ACTUALIZADO: PayloadBackOffice;
  }>();

 async publicarBackOffice(
    datos: NuevoEventoBackOffice,
  ): Promise<void> {
    const evento: EventoBackOffice = {
      ...datos,
      eventoId: randomUUID(),
      ocurridoEn: new Date().toISOString(),
    };

    try {
      await this.pubSub.publish(CANAL_BACKOFFICE, { backOfficeActualizado: evento });
    } catch {
      this.logger.error("No se pudo publicar el evento de BackOffice.");
      //aseguramos que si la notificacion falla no parezca que falló la compra
    }
  }

  escucharBackOffice(): AsyncIterableIterator<PayloadBackOffice> {
    return this.pubSub.asyncIterableIterator<PayloadBackOffice>(
      CANAL_BACKOFFICE,
    );
  }
}