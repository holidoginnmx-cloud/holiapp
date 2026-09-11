/**
 * Rutas cuyo path lleva la credencial de acceso: el token de una cotización
 * (quien lo tiene ve precios y datos del cliente) y la llave de una invitación
 * para compartir mascota (quien la tiene se vuelve co-dueño). En los logs se
 * reemplaza por un marcador; lo demás de la URL se queda para poder diagnosticar.
 */
const SECRET_PATHS = [/^(\/invites\/)[^/?#]+/, /^(\/public\/quotes\/)[^/?#]+/];

export function redactSecretPath(url: string): string {
  for (const re of SECRET_PATHS) {
    if (re.test(url)) return url.replace(re, "$1[redactado]");
  }
  return url;
}
