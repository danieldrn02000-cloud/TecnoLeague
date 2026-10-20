import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Query,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { InvalidWebhookSignatureError, WebhookSignatureValidator } from "mercadopago";
import { PagosService } from "./pagos.service";

@Controller("pagos")
export class PagosController {
  private readonly logger = new Logger(PagosController.name);
  constructor(private readonly pagos: PagosService) {}

  @Post("webhook")
  @HttpCode(200)
  async webhook(
    @Headers("x-signature") firma: string | undefined,
    @Headers("x-request-id") requestId: string | undefined,
    @Query("data.id") recursoId: string | undefined,
    @Body() body: unknown,
  ) {
    const secreto = process.env.MP_WEBHOOK_SECRET?.trim();
    if (!secreto)
      throw new ServiceUnavailableException(
        "Falta MP_WEBHOOK_SECRET en el backend.",
      );
    if (
      typeof firma !== "string" ||
      typeof requestId !== "string" ||
      !requestId ||
      typeof recursoId !== "string" ||
      !/^[a-zA-Z0-9_-]{1,150}$/.test(recursoId)
    ) {
      throw new UnauthorizedException("Notificación sin firma válida.");
    }
    try {
      WebhookSignatureValidator.validate({
        xSignature: firma,
        xRequestId: requestId,
        dataId: recursoId.toLowerCase(),
        secret: secreto,
      });
    } catch (error) {
      this.logger.warn(JSON.stringify({
        resultado: "WEBHOOK_FIRMA_INVALIDA",
        motivo: error instanceof InvalidWebhookSignatureError ? error.reason : "ERROR_VALIDACION",
        requestId: /^[A-Za-z0-9_-]{1,150}$/.test(requestId) ? requestId : undefined,
      }));
      throw new UnauthorizedException("Firma inválida.");
    }
    const notificacion = body as {
      type?: unknown;
      data?: { id?: unknown };
    } | null;
    if (
      typeof notificacion?.type !== "string" ||
      !["string", "number"].includes(typeof notificacion.data?.id) ||
      String(notificacion.data?.id) !== recursoId
    ) {
      throw new BadRequestException(
        "El tipo o ID de la notificación no es válido.",
      );
    }
    // 200 significa notificación atendida. El resultado explica si se confirmó,
    // continúa pendiente, se repitió o se ignoró; los fallos temporales son 503.
    const resultado = await this.pagos.procesarWebhook(
      notificacion.type,
      recursoId,
    );
    return { recibido: true, ...resultado };
  }
}
