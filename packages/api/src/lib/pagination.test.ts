import { describe, expect, it } from "vitest";

import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  buildPage,
  parsePageRequest,
  prismaPageArgs,
} from "./pagination";
import type { Page } from "./pagination";

// Lo que se protege aquí: (1) que la app YA INSTALADA, que pide sin ningún
// parámetro, siga recibiendo exactamente lo de antes; (2) que el cursor no
// repita ni se salte filas.

describe("parsePageRequest — compatibilidad hacia atrás", () => {
  it("sin parámetros no pagina", () => {
    const r = parsePageRequest({});
    expect(r).toEqual({ ok: true, page: { paginated: false } });
  });

  it("tampoco pagina con parámetros vacíos (querystring tipo ?limit=)", () => {
    expect(parsePageRequest({ limit: "", cursor: "" })).toEqual({
      ok: true,
      page: { paginated: false },
    });
    expect(parsePageRequest({ limit: "   " })).toEqual({
      ok: true,
      page: { paginated: false },
    });
  });

  it("ignora otros parámetros del querystring", () => {
    const r = parsePageRequest({ ...({ status: "ACTIVE" } as any) });
    expect(r).toEqual({ ok: true, page: { paginated: false } });
  });
});

describe("parsePageRequest — activación", () => {
  it("con limit pagina", () => {
    expect(parsePageRequest({ limit: "20" })).toEqual({
      ok: true,
      page: { paginated: true, limit: 20, cursor: undefined },
    });
  });

  it("acepta limit numérico (no solo string del querystring)", () => {
    expect(parsePageRequest({ limit: 5 })).toEqual({
      ok: true,
      page: { paginated: true, limit: 5, cursor: undefined },
    });
  });

  it("con cursor pero sin limit usa el límite por defecto", () => {
    expect(parsePageRequest({ cursor: "clx123" })).toEqual({
      ok: true,
      page: { paginated: true, limit: DEFAULT_PAGE_LIMIT, cursor: "clx123" },
    });
  });

  it("recorta el limit al tope en vez de fallar", () => {
    const r = parsePageRequest({ limit: String(MAX_PAGE_LIMIT + 500) });
    expect(r.ok && r.page.paginated && r.page.limit).toBe(MAX_PAGE_LIMIT);
  });

  it("respeta defaultLimit y maxLimit propios del endpoint", () => {
    expect(parsePageRequest({ cursor: "abc" }, { defaultLimit: 10 })).toEqual({
      ok: true,
      page: { paginated: true, limit: 10, cursor: "abc" },
    });
    const r = parsePageRequest({ limit: "999" }, { maxLimit: 30 });
    expect(r.ok && r.page.paginated && r.page.limit).toBe(30);
  });

  it("recorta espacios del cursor", () => {
    const r = parsePageRequest({ cursor: " clx123 " });
    expect(r.ok && r.page.paginated && r.page.cursor).toBe("clx123");
  });
});

describe("parsePageRequest — entradas inválidas", () => {
  it.each(["0", "-5", "abc", "1.5", "NaN", "Infinity", "1e400"])(
    "rechaza limit=%s en vez de devolver todo en silencio",
    (limit) => {
      const r = parsePageRequest({ limit });
      expect(r.ok).toBe(false);
    }
  );

  it("rechaza un cursor que no parece un id", () => {
    expect(parsePageRequest({ cursor: "abc'; DROP TABLE--" }).ok).toBe(false);
    expect(parsePageRequest({ cursor: "x".repeat(65) }).ok).toBe(false);
  });

  it("acepta cuid y uuid como cursor", () => {
    expect(parsePageRequest({ cursor: "clx9k2m4p0000abcd1234efgh" }).ok).toBe(true);
    expect(
      parsePageRequest({ cursor: "3f2504e0-4f89-11d3-9a0c-0305e82c3301" }).ok
    ).toBe(true);
  });
});

describe("prismaPageArgs", () => {
  it("sin paginación no agrega NADA a la consulta de siempre", () => {
    expect(prismaPageArgs({ paginated: false })).toEqual({});
  });

  it("pide una fila de más para saber si hay siguiente página", () => {
    expect(prismaPageArgs({ paginated: true, limit: 20 })).toEqual({ take: 21 });
  });

  it("con cursor salta la fila del propio cursor", () => {
    expect(prismaPageArgs({ paginated: true, limit: 20, cursor: "c1" })).toEqual({
      take: 21,
      cursor: { id: "c1" },
      skip: 1,
    });
  });
});

describe("buildPage", () => {
  const rows = (n: number, offset = 0) =>
    Array.from({ length: n }, (_, i) => ({ id: `r${i + offset}` }));

  it("corta la fila extra y devuelve el cursor de la última entregada", () => {
    const page = buildPage(rows(4), 3);
    expect(page.items.map((r) => r.id)).toEqual(["r0", "r1", "r2"]);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe("r2");
  });

  it("última página: sin cursor siguiente", () => {
    const page = buildPage(rows(3), 3);
    expect(page.items).toHaveLength(3);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it("lista vacía", () => {
    expect(buildPage([], 10)).toEqual({ items: [], nextCursor: null, hasMore: false });
  });

  it("recorriendo con el cursor no repite ni pierde filas", () => {
    // Simula la tabla completa y el ciclo cursor→siguiente página.
    const all: Array<{ id: string }> = rows(7);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard++) {
      const at: number = cursor === null ? -1 : all.findIndex((r) => r.id === cursor);
      const start: number = at + 1;
      const page: Page<{ id: string }> = buildPage(all.slice(start, start + 4), 3);
      seen.push(...page.items.map((r) => r.id));
      if (!page.hasMore) break;
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(all.map((r) => r.id));
  });
});
