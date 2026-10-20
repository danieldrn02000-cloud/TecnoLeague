// Solo mensajes propios: nunca mostrar mensajes libres ni cuerpos de Mercado Pago.
const mensajes: Record<string, string> = {};
function registrar(codigos: string[], mensaje: string) {
  for (const codigo of codigos) mensajes[codigo] = mensaje;
}
registrar(["cc_rejected_insufficient_amount", "insufficient_amount", "insufficient_funds"],
  "Tu tarjeta no tiene fondos suficientes. Prueba con otra tarjeta o consulta con tu banco.");
registrar(["cc_rejected_card_expired", "card_expired", "expired_card"],
  "Tu tarjeta está vencida. Usa una tarjeta vigente.");
registrar(["cc_rejected_bad_filled_date", "bad_filled_date"],
  "Revisa la fecha de vencimiento de tu tarjeta.");
registrar(["cc_rejected_bad_filled_card_number", "bad_filled_card_number"],
  "Revisa el número de tu tarjeta.");
registrar(["cc_rejected_bad_filled_security_code", "bad_filled_security_code"],
  "Revisa el código de seguridad de tu tarjeta.");
registrar(["cc_rejected_bad_filled_other", "bad_filled_other"],
  "Revisa los datos de tu tarjeta e inténtalo de nuevo.");
registrar(["cc_rejected_card_disabled", "card_disabled"],
  "Tu tarjeta no está habilitada para este pago. Actívala o consulta con tu banco.");
registrar(["cc_rejected_call_for_authorize", "call_for_authorize"],
  "Tu banco necesita autorizar este pago. Comunícate con él o usa otra tarjeta.");
registrar(["cc_rejected_invalid_installments", "invalid_installments"],
  "Tu tarjeta no permite el número de pagos seleccionado. Elige otra opción.");
registrar(["cc_rejected_3ds_challenge", "3ds_challenge_failed"],
  "No se pudo completar la verificación de tu banco. Inténtalo de nuevo o usa otra tarjeta.");
registrar(["cc_rejected_high_risk", "high_risk", "rejected_by_bank", "cc_rejected_other_reason"],
  "El pago fue rechazado por seguridad o por una decisión del banco. Usa otra tarjeta o consulta con tu banco.");

const general = "No se pudo aprobar el pago. Prueba con otra tarjeta o consulta con tu banco.";
const mensajesPermitidos = new Set([...Object.values(mensajes), general]);
export function esMotivoTarjeta(codigo: unknown): codigo is string {
  return typeof codigo === "string" && Object.hasOwn(mensajes, codigo);
}
export function mensajeRechazoPago(codigos: readonly unknown[], mensajeGeneral = general): string {
  for (const codigo of codigos) {
    if (esMotivoTarjeta(codigo)) return mensajes[codigo];
    if (typeof codigo === "string" && mensajesPermitidos.has(codigo)) return codigo;
  }
  return mensajeGeneral;
}
