import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEstadoMensualidad, resetMensualidadCache } from "./mensualidad";

const PENDIENTE = {
  pendiente: true,
  cobros: [
    {
      periodo: "2026-10-01",
      concepto: "Holidog — soporte de las 3 apps",
      saldo: 2000,
      fechaVencimiento: "2026-10-15",
    },
  ],
  datosPago: { banco: "Banco", titular: "Titular", clabe: "012345678901234567" },
};

function respuesta(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe("getEstadoMensualidad", () => {
  beforeEach(() => {
    resetMensualidadCache();
    process.env.PASTA_URL = "https://pasta.test/";
    process.env.PASTA_ESTADO_SECRET = "s3creto";
    process.env.PASTA_CLIENTE_ID = "8994ea50-123c-499f-b26e-7549dfeb6427";
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("pasa lo que dice Pasta cuando hay adeudo, con el secreto como Bearer", async () => {
    const f = respuesta(PENDIENTE);
    const estado = await getEstadoMensualidad(f, 0);
    expect(estado).toEqual(PENDIENTE);
    const [url, init] = (f as any).mock.calls[0];
    expect(url).toBe(
      "https://pasta.test/api/externo/estado-mensualidad?cliente=8994ea50-123c-499f-b26e-7549dfeb6427",
    );
    expect(init.headers.Authorization).toBe("Bearer s3creto");
  });

  it("al corriente cuando ya está pagado", async () => {
    const estado = await getEstadoMensualidad(respuesta({ pendiente: false, cobros: [], datosPago: null }), 0);
    expect(estado.pendiente).toBe(false);
  });

  it("deja pasar si Pasta da error, si truena el fetch o si faltan las env", async () => {
    expect((await getEstadoMensualidad(respuesta({ error: "x" }, 500), 0)).pendiente).toBe(false);

    resetMensualidadCache();
    const truena = vi.fn(async () => {
      throw new Error("timeout");
    }) as unknown as typeof fetch;
    expect((await getEstadoMensualidad(truena, 0)).pendiente).toBe(false);

    resetMensualidadCache();
    delete process.env.PASTA_ESTADO_SECRET;
    const f = respuesta(PENDIENTE);
    expect((await getEstadoMensualidad(f, 0)).pendiente).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it("ignora una respuesta con forma rara", async () => {
    expect((await getEstadoMensualidad(respuesta({ pendiente: "si" }), 0)).pendiente).toBe(false);
  });

  it("cachea 5 min el resultado bueno y solo 1 min un error", async () => {
    const f = respuesta(PENDIENTE);
    await getEstadoMensualidad(f, 0);
    await getEstadoMensualidad(f, 4 * 60_000);
    expect(f).toHaveBeenCalledTimes(1);
    await getEstadoMensualidad(f, 5 * 60_000 + 1);
    expect(f).toHaveBeenCalledTimes(2);

    resetMensualidadCache();
    const malo = respuesta({}, 502);
    await getEstadoMensualidad(malo, 0);
    await getEstadoMensualidad(malo, 61_000);
    expect(malo).toHaveBeenCalledTimes(2);
  });
});
