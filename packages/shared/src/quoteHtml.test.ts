import { describe, expect, it } from "vitest";

import { esc, renderQuoteHtml, type PublicQuote } from "./quoteHtml";

// La plantilla es el ÚNICO documento que sale hacia el cliente: se sirve en la
// página pública (inyectada con dangerouslySetInnerHTML bajo el dominio del
// hotel) y se convierte en el PDF que se manda por WhatsApp. Estos tests cubren
// las dos formas en que puede fallar de manera cara: dejando pasar HTML de un
// campo libre, o imprimiendo algo que era interno.

const BASE: PublicQuote = {
  folio: 123,
  serviceType: "STAY",
  status: "SENT",
  clientName: "Ana Pérez",
  createdAt: "2026-08-26T12:00:00.000Z",
  validUntil: "2026-09-02T12:00:00.000Z",
  isExpired: false,
  checkIn: "2026-09-01T00:00:00.000Z",
  checkOut: "2026-09-06T00:00:00.000Z",
  totalDays: 5,
  pets: [
    {
      name: "Molly",
      breed: "Schnauzer",
      weightKg: 12,
      subtotal: 1750,
      lines: [
        {
          kind: "LODGING",
          label: "Hospedaje · 5 noches",
          detail: "Perro chico (12 kg) · $350 por noche",
          quantity: 5,
          unitPrice: 350,
          amount: 1750,
          isCourtesy: false,
          listPrice: 1750,
        },
      ],
    },
  ],
  groupLines: [],
  subtotal: 1750,
  discountTotal: 0,
  deliveryFee: 0,
  total: 1750,
  depositSuggested: 350,
  notes: null,
  hotelName: "Holidog Inn",
  hotelPhone: "662 205 7580",
  whatsappUrl: "https://wa.me/5216622057580?text=Hola",
};

describe("esc", () => {
  it("escapa los cinco caracteres que rompen HTML", () => {
    expect(esc(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &#39;");
  });

  it("deja vacío lo nulo en vez de imprimir 'null'", () => {
    expect(esc(null)).toBe("");
    expect(esc(undefined)).toBe("");
    // 0 sí se imprime: es un monto válido.
    expect(esc(0)).toBe("0");
  });
});

describe("renderQuoteHtml · escapado", () => {
  const XSS = `<script>alert('x')</script>`;

  it("neutraliza HTML en el nombre del cliente", () => {
    const html = renderQuoteHtml({ ...BASE, clientName: XSS });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("neutraliza HTML en el nombre y la raza de la mascota", () => {
    const html = renderQuoteHtml({
      ...BASE,
      pets: [{ ...BASE.pets[0], name: XSS, breed: `<img onerror="alert(1)">` }],
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img onerror");
  });

  it("neutraliza HTML en las etiquetas y detalles de las líneas", () => {
    const html = renderQuoteHtml({
      ...BASE,
      pets: [
        {
          ...BASE.pets[0],
          lines: [{ ...BASE.pets[0].lines[0], label: XSS, detail: XSS }],
        },
      ],
    });
    expect(html).not.toContain("<script>");
  });

  it("neutraliza HTML en la nota visible, conservando los saltos de línea", () => {
    const html = renderQuoteHtml({ ...BASE, notes: `Incluye <b>todo</b>\nSin extras` });
    expect(html).not.toContain("<b>todo</b>");
    expect(html).toContain("&lt;b&gt;todo&lt;/b&gt;");
    expect(html).toContain("Sin extras");
    // El <br> es nuestro, no del usuario: se inserta DESPUÉS de escapar.
    expect(html).toContain("<br>");
  });

  it("neutraliza una URL de WhatsApp manipulada", () => {
    const html = renderQuoteHtml({
      ...BASE,
      whatsappUrl: `https://wa.me/1?text=x" onmouseover="alert(1)`,
    });
    expect(html).not.toContain('" onmouseover="');
  });
});

describe("renderQuoteHtml · nada interno se filtra", () => {
  it("no puede imprimir notas internas: el tipo no las tiene", () => {
    // Se fuerza un objeto con campos internos para simular un mapeo descuidado
    // en el servidor. Aunque lleguen, la plantilla no tiene dónde ponerlos.
    const conBasura = {
      ...BASE,
      internalNotes: "MARCADOR_SECRETO",
      courtesyReason: "MARCADOR_2",
      pricingSnapshot: { secreto: "MARCADOR_3" },
      createdById: "MARCADOR_4",
    } as PublicQuote;

    const html = renderQuoteHtml(conBasura);
    expect(html).not.toContain("MARCADOR_SECRETO");
    expect(html).not.toContain("MARCADOR_2");
    expect(html).not.toContain("MARCADOR_3");
    expect(html).not.toContain("MARCADOR_4");
  });

  it("tampoco imprime el motivo de una cortesía", () => {
    const html = renderQuoteHtml({
      ...BASE,
      pets: [
        {
          ...BASE.pets[0],
          lines: [
            {
              ...BASE.pets[0].lines[0],
              isCourtesy: true,
              amount: 0,
              // @ts-expect-error el motivo es interno y no existe en el tipo público
              courtesyReason: "MARCADOR_CORTESIA",
            },
          ],
        },
      ],
    });
    expect(html).not.toContain("MARCADOR_CORTESIA");
    expect(html).toContain("Cortesía");
  });
});

describe("renderQuoteHtml · contenido", () => {
  it("muestra el folio, el cliente y el total", () => {
    const html = renderQuoteHtml(BASE);
    expect(html).toContain("COT-000123");
    expect(html).toContain("Ana Pérez");
    expect(html).toContain("$1,750");
  });

  it("muestra una cortesía con su precio tachado, no como línea gratis anónima", () => {
    const html = renderQuoteHtml({
      ...BASE,
      pets: [
        {
          ...BASE.pets[0],
          lines: [
            { ...BASE.pets[0].lines[0] },
            {
              kind: "BATH",
              label: "Baño",
              detail: "Talla M",
              quantity: 1,
              unitPrice: 320,
              amount: 0,
              isCourtesy: true,
              listPrice: 320,
            },
          ],
        },
      ],
    });
    expect(html).toContain("q-strike");
    expect(html).toContain("$320"); // el cliente ve lo que se le regaló
    expect(html).toContain("Cortesía");
  });

  it("avisa cuando está vencida en vez de esconder el documento", () => {
    const html = renderQuoteHtml({ ...BASE, isExpired: true });
    expect(html).toContain("venció");
    expect(html).toContain("COT-000123"); // el documento se sigue viendo
  });

  it("oculta el botón de WhatsApp en el PDF", () => {
    expect(renderQuoteHtml(BASE, { target: "pdf" })).not.toContain("Reservar por WhatsApp");
    expect(renderQuoteHtml(BASE, { target: "web" })).toContain("Reservar por WhatsApp");
  });

  it("no carga NADA remoto (expo-print y la CSP no lo permitirían)", () => {
    const html = renderQuoteHtml(BASE);
    expect(html).not.toMatch(/<img\s/i);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/@import/i);
    expect(html).not.toMatch(/https?:\/\/(?!wa\.me)/);
  });

  it("formatea las fechas en UTC: la estancia no se corre un día", () => {
    // checkIn es 2026-09-01T00:00:00Z. Con formato en hora local (y el proceso
    // en cualquier zona al oeste de UTC) diría 31 de agosto.
    const html = renderQuoteHtml(BASE);
    expect(html).toContain("1 de septiembre");
    expect(html).not.toContain("31 de agosto");
  });

  it("cotiza sin fechas cerradas mostrando solo las noches", () => {
    const html = renderQuoteHtml({
      ...BASE,
      checkIn: null,
      checkOut: null,
      totalDays: 5,
    });
    expect(html).toContain("5 noches");
  });
});

describe("renderQuoteHtml · zonas horarias", () => {
  it("imprime la emisión en hora de Hermosillo, no en UTC", () => {
    // 26-ago 18:30 en Hermosillo (UTC-7) es 27-ago 01:30Z. En UTC el documento
    // diría que se emitió el 27, un día después de la conversación con el
    // cliente.
    const html = renderQuoteHtml({ ...BASE, createdAt: "2026-08-27T01:30:00.000Z" });
    expect(html).toContain("26 de agosto");
    expect(html).not.toContain("27 de agosto");
  });

  it("la vigencia también se lee en hora del hotel", () => {
    // resolveValidUntil ancla el fin del día a 23:59:59-07:00, que en UTC es el
    // día siguiente a las 06:59:59Z.
    const html = renderQuoteHtml({ ...BASE, validUntil: "2026-09-03T06:59:59.999Z" });
    expect(html).toContain("Vigente hasta el 2 de septiembre");
  });

  it("las fechas del SERVICIO siguen leyéndose en UTC: son días, no instantes", () => {
    const html = renderQuoteHtml(BASE); // checkIn 2026-09-01T00:00:00Z
    expect(html).toContain("1 de septiembre");
  });

  it("no imprime el descuento dos veces: solo en el bloque de totales", () => {
    const html = renderQuoteHtml({
      ...BASE,
      groupLines: [
        {
          kind: "DISCOUNT",
          label: "Descuento PROMO10",
          quantity: 1,
          unitPrice: -175,
          amount: -175,
          isCourtesy: false,
          listPrice: -175,
        },
      ],
      discountTotal: 175,
      total: 1575,
    });
    // Una sola aparición: la del bloque de totales.
    expect(html.match(/Descuento/g)?.length).toBe(1);
  });
});
