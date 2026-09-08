// Normaliza un teléfono a sus últimos 10 dígitos (estándar nacional MX),
// descartando espacios, guiones, paréntesis y lada de país/larga distancia
// (+52, 044, 01, etc.). Los teléfonos en la BD están en formato libre (el admin
// los captura tal cual), así que comparamos por esta forma canónica.
// Devuelve null si no hay al menos 10 dígitos.
export function normalizePhone(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

/**
 * Teléfono de una ficha → E.164 para mandarle un SMS ("+526621234567").
 *
 * OJO: NO se construye sobre `normalizePhone`. Ese helper tira la lada A
 * PROPÓSITO porque sirve para COMPARAR, no para MARCAR: un cliente con número
 * de otro país quedaría convertido en "+52<sus 10 dígitos>", que es un móvil
 * MEXICANO de un desconocido — y ahí le llegaría el código. En la base hay al
 * menos una ficha con prefijo internacional ("001…"), así que el caso es real.
 *
 * Por eso aquí se lee el string CRUDO tal como lo capturó el equipo y, cuando
 * no se puede saber el país con certeza, se devuelve null y no se manda nada
 * (el cliente ve el respaldo de WhatsApp). Preferimos no mandar el código a
 * mandárselo a la persona equivocada.
 */
export function toE164(raw?: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  let digits = s.replace(/\D/g, "");
  if (!digits) return null;

  // 1) Lada internacional explícita (+1…, 0034…): alguien la escribió a
  //    propósito, así que se respeta.
  if (s.startsWith("+") || digits.startsWith("00")) {
    if (digits.startsWith("00")) digits = digits.slice(2);
    // Ojo: "+52 1 662…" es México con el "1" viejo, no un número de 13
    // dígitos. Sin colapsarlo, la misma persona capturada como "+521662…" y
    // como "6621234567" produce dos E.164 distintos, `pickSmsTarget` los ve
    // como personas distintas y no manda nada.
    if (digits.length === 13 && digits.startsWith("521")) return `+52${digits.slice(-10)}`;
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }

  // 2) Prefijos mexicanos de larga distancia que el equipo todavía teclea.
  digits = digits.replace(/^(01|044|045)/, "");

  // 3) 52 / 521 al frente = México con lada (el "1" es la forma vieja, la que
  //    sigue usando WhatsApp).
  if (digits.length === 12 && digits.startsWith("52")) return `+52${digits.slice(-10)}`;
  if (digits.length === 13 && digits.startsWith("521")) return `+52${digits.slice(-10)}`;

  // 4) 10 dígitos pelones = nacional MX, que es como los captura el equipo.
  if (digits.length === 10) return `+52${digits}`;

  // 5) 11 dígitos que empiezan con 1 se quedan SIN mandar, aunque parezcan de
  //    EE.UU. Es genuinamente ambiguo: "1" + 10 dígitos es tanto el formato
  //    NANP como el formato mexicano viejo (el mismo "1" que WhatsApp sigue
  //    usando). Si acertamos, el cliente recibe su código; si fallamos, se lo
  //    mandamos a un desconocido en otro país. No vale la pena: quien de
  //    verdad sea de fuera se captura con su lada ("+1 626…") y entra por la
  //    rama 1, y mientras tanto ve el respaldo de WhatsApp.
  return null;
}
