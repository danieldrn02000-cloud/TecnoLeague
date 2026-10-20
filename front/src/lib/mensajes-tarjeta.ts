export function mensajeCampoTarjeta(campo: string): string | undefined {
  if (["expirationDate", "expirationMonth", "expirationYear"].includes(campo)) {
    return "Revisa el vencimiento: usa una fecha válida y una tarjeta vigente.";
  }
  if (campo === "cardNumber") return "Revisa el número de tu tarjeta.";
  if (campo === "securityCode") return "Revisa el código de seguridad de tu tarjeta.";
  if (campo === "cardholderName") return "Revisa el nombre del titular de la tarjeta.";
}

// Los errores del SDK pueden ser arrays o tener cause/errors. No mostramos
// sus mensajes libres ni leemos el número, vencimiento o CVV de los iframes.
export function mensajeErrorTarjeta(error: unknown): string {
  const codigos: Record<string, string> = {
    E301: "cardNumber", E302: "securityCode", "205": "cardNumber",
    "208": "expirationMonth", "209": "expirationYear", "325": "expirationMonth",
    "326": "expirationYear", "221": "cardholderName", "316": "cardholderName",
  };
  const buscar = (valor: unknown, nivel = 0): string | undefined => {
    if (nivel > 4) return;
    if (Array.isArray(valor)) {
      for (const item of valor.slice(0, 10)) { const mensaje = buscar(item, nivel + 1); if (mensaje) return mensaje; }
    } else if (valor && typeof valor === "object") {
      const dato = valor as Record<string, unknown>;
      const campo = typeof dato.field === "string" ? mensajeCampoTarjeta(dato.field) : undefined;
      if (campo) return campo;
      const codigo = typeof dato.code === "string" || typeof dato.code === "number" ? String(dato.code) : "";
      if (Object.hasOwn(codigos, codigo)) return mensajeCampoTarjeta(codigos[codigo]);
      for (const clave of ["cause", "errors", "error"]) { const mensaje = buscar(dato[clave], nivel + 1); if (mensaje) return mensaje; }
    }
  };
  return buscar(error) ?? "No pudimos validar tu tarjeta. Revisa los datos e inténtalo de nuevo.";
}
