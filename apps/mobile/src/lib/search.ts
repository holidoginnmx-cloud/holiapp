// Búsqueda del equipo sobre listas que ya están en memoria (clientes,
// mascotas, hospedados). Cada palabra se busca por separado y en cualquier
// campo: "luz ruiz" encuentra a "Luz Armenta Ruiz", que como frase completa no
// está en ningún lado (así fallaba antes). Sin acentos ni mayúsculas.
//
// Si con las palabras exactas no sale nadie, se tolera una letra de más, de
// menos o cambiada en las palabras de 4 letras o más ("luiz" → "Luz",
// "armneta" no, "armemta" → "Armenta"). Solo como segundo intento, para no
// llenar de parecidos una búsqueda que ya encontró lo que buscaba.

export type CamposBusqueda = {
  textos: Array<string | null | undefined>;
  /** Se comparan solo por dígitos: "(662) 180-2448" se encuentra con "6621802448". */
  telefonos?: Array<string | null | undefined>;
};

export function normalizarBusqueda(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function palabrasBusqueda(q: string): string[] {
  const n = normalizarBusqueda(q);
  return n ? n.split(" ") : [];
}

const PALABRA_NUMERICA = /^[\d()+\-.]+$/;

/** ¿`a` y `b` difieren a lo más en una letra (sobra, falta o cambia)? */
function aUnaLetra(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let diferencias = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++diferencias > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else {
      i++;
      j++;
    }
  }
  return diferencias + (a.length - i) + (b.length - j) <= 1;
}

function preparar(campos: CamposBusqueda) {
  const texto = normalizarBusqueda(campos.textos.filter(Boolean).join(" "));
  return {
    texto,
    palabras: texto.split(/[^a-z0-9]+/).filter(Boolean),
    digitos: (campos.telefonos ?? []).map((t) => (t ?? "").replace(/\D/g, "")).filter(Boolean),
  };
}

function coincidePalabra(
  p: string,
  c: ReturnType<typeof preparar>,
  tolerante: boolean,
): boolean {
  if (c.texto.includes(p)) return true;
  if (PALABRA_NUMERICA.test(p)) {
    const d = p.replace(/\D/g, "");
    return d.length > 0 && c.digitos.some((t) => t.includes(d));
  }
  if (!tolerante || p.length < 4) return false;
  // Contra la palabra entera o contra su inicio, para lo que se va tecleando.
  return c.palabras.some(
    (w) => aUnaLetra(p, w) || (w.length > p.length && aUnaLetra(p, w.slice(0, p.length))),
  );
}

/** ¿Todas las palabras de `q` están en algún campo? Una búsqueda vacía coincide con todo. */
export function coincideBusqueda(q: string, campos: CamposBusqueda, tolerante = false): boolean {
  const palabras = palabrasBusqueda(q);
  if (palabras.length === 0) return true;
  const c = preparar(campos);
  return palabras.every((p) => coincidePalabra(p, c, tolerante));
}

/** Filtra `items` por `q`: primero exacto y, si no sale nadie, con tolerancia a una letra. */
export function filtrarPorBusqueda<T>(
  items: T[],
  q: string,
  campos: (item: T) => CamposBusqueda,
): T[] {
  const palabras = palabrasBusqueda(q);
  if (palabras.length === 0) return items;
  const preparados = items.map((item) => ({ item, c: preparar(campos(item)) }));
  const pasa = (tolerante: boolean) =>
    preparados
      .filter(({ c }) => palabras.every((p) => coincidePalabra(p, c, tolerante)))
      .map(({ item }) => item);
  const exactos = pasa(false);
  return exactos.length > 0 ? exactos : pasa(true);
}
