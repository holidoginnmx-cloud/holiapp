import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetQuotas, takeQuota } from "./quota";

beforeEach(() => {
  resetQuotas();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

const VENTANA = 60_000;

describe("takeQuota", () => {
  it("deja pasar hasta el máximo y luego cierra", () => {
    expect(takeQuota("k", 3, VENTANA)).toBe(true);
    expect(takeQuota("k", 3, VENTANA)).toBe(true);
    expect(takeQuota("k", 3, VENTANA)).toBe(true);
    expect(takeQuota("k", 3, VENTANA)).toBe(false);
  });

  it("se reabre al pasar la ventana", () => {
    expect(takeQuota("k", 1, VENTANA)).toBe(true);
    expect(takeQuota("k", 1, VENTANA)).toBe(false);
    vi.advanceTimersByTime(VENTANA + 1);
    expect(takeQuota("k", 1, VENTANA)).toBe(true);
  });

  it("las llaves son independientes", () => {
    expect(takeQuota("sms:num:+526621234567", 1, VENTANA)).toBe(true);
    expect(takeQuota("sms:num:+526629998888", 1, VENTANA)).toBe(true);
    expect(takeQuota("sms:num:+526621234567", 1, VENTANA)).toBe(false);
  });

  it("una avalancha de llaves NO reabre el cupo de otra", () => {
    // Antes esto era un `.clear()` al pasar de 5000 entradas: bastaba con
    // generar ruido para que se borrara el contador del SMS y volver a enviar.
    expect(takeQuota("sms:global", 1, VENTANA)).toBe(true);
    expect(takeQuota("sms:global", 1, VENTANA)).toBe(false);

    for (let i = 0; i < 6000; i++) takeQuota(`ruido:${i}`, 100, VENTANA);

    expect(takeQuota("sms:global", 1, VENTANA)).toBe(false);
  });

  it("bajo saturación niega llaves nuevas en vez de desalojar vivas", () => {
    for (let i = 0; i < 5200; i++) takeQuota(`ruido:${i}`, 100, VENTANA);
    // Fail-closed: ante lo que solo puede ser abuso, no se envía.
    expect(takeQuota("nueva", 1, VENTANA)).toBe(false);
  });

  it("al vencer la ventana se libera el espacio y todo vuelve a la normalidad", () => {
    for (let i = 0; i < 5200; i++) takeQuota(`viejo:${i}`, 100, VENTANA);
    vi.advanceTimersByTime(VENTANA + 1); // todas vencen
    expect(takeQuota("nueva", 1, VENTANA)).toBe(true);
    expect(takeQuota("nueva", 1, VENTANA)).toBe(false); // sigue contando bien
  });
});
