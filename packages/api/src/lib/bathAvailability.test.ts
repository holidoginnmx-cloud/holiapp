import { describe, expect, it } from "vitest";

import {
  BathScheduleCfg,
  BusyInterval,
  buildStartCandidates,
  chainStarts,
  conflictsWith,
  dayRangeUtc,
  evaluateStart,
  formatDuration,
  formatLocalTime,
  localMinutesOfDay,
  localYMD,
  overlapCount,
  ymdAtLocalMinutes,
} from "./bathAvailability";

// Config de referencia: la operación real (una estilista, 9:00–18:00,
// inicios cada 30 min, 15 min de limpieza entre perros).
const cfg: BathScheduleCfg = {
  openHour: 9,
  closeHour: 18,
  slotStepMinutes: 30,
  defaultBathDurationMinutes: 60,
  lastStartHour: null,
  bufferMinutes: 15,
  maxConcurrentBaths: 1,
  isActive: true,
};

const DAY = "2026-08-15";

/** Cita ya agendada ese día, en hora local del hotel. */
function busyAt(
  startMinLocal: number,
  durationMin: number,
  id = "r1",
  label = "Luna"
): BusyInterval {
  const start = ymdAtLocalMinutes(DAY, startMinLocal);
  return {
    startMs: start.getTime(),
    endMs: start.getTime() + durationMin * 60_000,
    id,
    label,
  };
}

// Un "ahora" muy anterior al día bajo prueba, para que PAST no interfiera.
const EARLY = new Date("2026-08-01T00:00:00Z");

describe("conversión UTC ↔ hora local del hotel (UTC-7 fijo)", () => {
  it("ymdAtLocalMinutes y localYMD/localMinutesOfDay son inversas", () => {
    const d = ymdAtLocalMinutes(DAY, 9 * 60 + 30);
    expect(localYMD(d)).toBe(DAY);
    expect(localMinutesOfDay(d)).toBe(9 * 60 + 30);
    // 9:30 local Hermosillo = 16:30 UTC.
    expect(d.toISOString()).toBe("2026-08-15T16:30:00.000Z");
  });

  it("la madrugada UTC pertenece al día local anterior", () => {
    // 2026-08-16T02:00Z = 19:00 del 15 en Hermosillo.
    const d = new Date("2026-08-16T02:00:00Z");
    expect(localYMD(d)).toBe("2026-08-15");
    expect(localMinutesOfDay(d)).toBe(19 * 60);
  });

  it("dayRangeUtc cubre el día local completo", () => {
    const { start, end } = dayRangeUtc(DAY);
    expect(start.toISOString()).toBe("2026-08-15T07:00:00.000Z");
    expect(end.toISOString()).toBe("2026-08-16T07:00:00.000Z");
  });
});

describe("buildStartCandidates", () => {
  it("corta cuando el SERVICIO no termina antes del cierre, no cuando el slot no cabe", () => {
    const oneHour = buildStartCandidates(DAY, cfg, 60);
    // Último inicio de 1 h con cierre a las 18: 17:00.
    expect(localMinutesOfDay(oneHour[oneHour.length - 1]!)).toBe(17 * 60);

    const twoHours = buildStartCandidates(DAY, cfg, 120);
    // Último inicio de 2 h: 16:00 — se corta solo, sin mover configuración.
    expect(localMinutesOfDay(twoHours[twoHours.length - 1]!)).toBe(16 * 60);
    expect(twoHours.length).toBe(oneHour.length - 2);
  });

  it("ofrece inicios cada slotStepMinutes desde la apertura", () => {
    const starts = buildStartCandidates(DAY, cfg, 60);
    expect(localMinutesOfDay(starts[0]!)).toBe(9 * 60);
    expect(localMinutesOfDay(starts[1]!)).toBe(9 * 60 + 30);
  });

  it("respeta lastStartHour como tope duro", () => {
    const capped = buildStartCandidates(DAY, { ...cfg, lastStartHour: 14 }, 60);
    expect(localMinutesOfDay(capped[capped.length - 1]!)).toBe(14 * 60);
  });

  it("fecha inválida → sin candidatos", () => {
    expect(buildStartCandidates("15/08/2026", cfg, 60)).toEqual([]);
  });
});

describe("conflictsWith / overlapCount", () => {
  it("detecta traslape directo de intervalos", () => {
    const busy = [busyAt(10 * 60, 90)]; // 10:00–11:30
    const start = ymdAtLocalMinutes(DAY, 11 * 60); // 11:00, se encima 30 min
    expect(overlapCount(start, 60, cfg, busy)).toBe(1);
  });

  it("el buffer de limpieza separa por ambos lados", () => {
    const busy = [busyAt(10 * 60, 60)]; // 10:00–11:00 (+15 buffer)
    // Empezar exactamente a las 11:00 pisa el buffer.
    expect(overlapCount(ymdAtLocalMinutes(DAY, 11 * 60), 60, cfg, busy)).toBe(1);
    // A las 11:15 ya no (encaje exacto: 11:00 + 15 de limpieza).
    expect(overlapCount(ymdAtLocalMinutes(DAY, 11 * 60 + 15), 60, cfg, busy)).toBe(0);
    // Hacia atrás: terminar a las 9:45 encaja exacto (9:45 + 15 = 10:00)...
    expect(overlapCount(ymdAtLocalMinutes(DAY, 9 * 60), 45, cfg, busy)).toBe(0);
    // ...pero terminar a las 9:50 pisa el buffer.
    expect(overlapCount(ymdAtLocalMinutes(DAY, 9 * 60 + 5), 45, cfg, busy)).toBe(1);
  });

  it("citas colindantes sin buffer no chocan", () => {
    const noBuffer = { ...cfg, bufferMinutes: 0 };
    const busy = [busyAt(10 * 60, 60)];
    expect(
      conflictsWith(ymdAtLocalMinutes(DAY, 11 * 60), 60, noBuffer, busy)
    ).toEqual([]);
  });
});

describe("evaluateStart", () => {
  it("acepta un inicio válido en día libre", () => {
    const verdict = evaluateStart(
      ymdAtLocalMinutes(DAY, 10 * 60),
      60,
      cfg,
      [],
      EARLY
    );
    expect(verdict.ok).toBe(true);
  });

  it("PAST: rechaza horarios que ya pasaron", () => {
    const now = ymdAtLocalMinutes(DAY, 12 * 60);
    const verdict = evaluateStart(ymdAtLocalMinutes(DAY, 10 * 60), 60, cfg, [], now);
    expect(verdict).toMatchObject({ ok: false, reason: "PAST" });
  });

  it("OUT_OF_WINDOW: antes de abrir", () => {
    const verdict = evaluateStart(ymdAtLocalMinutes(DAY, 8 * 60), 60, cfg, [], EARLY);
    expect(verdict).toMatchObject({ ok: false, reason: "OUT_OF_WINDOW" });
  });

  it("CLOSES_TOO_LATE: el servicio terminaría después del cierre", () => {
    const verdict = evaluateStart(
      ymdAtLocalMinutes(DAY, 17 * 60),
      120,
      cfg,
      [],
      EARLY
    );
    expect(verdict).toMatchObject({ ok: false, reason: "CLOSES_TOO_LATE" });
    if (!verdict.ok) {
      expect(verdict.message).toContain("2 h");
    }
  });

  it("AFTER_LAST_START: pasa el tope duro aunque sí alcance antes del cierre", () => {
    const verdict = evaluateStart(
      ymdAtLocalMinutes(DAY, 15 * 60),
      60,
      { ...cfg, lastStartHour: 14 },
      [],
      EARLY
    );
    expect(verdict).toMatchObject({ ok: false, reason: "AFTER_LAST_START" });
  });

  it("CAPACITY: con una estilista, encimarse con otra cita rechaza y nombra al perro", () => {
    const busy = [busyAt(10 * 60, 120, "r9", "Rocky")]; // 10:00–12:00
    const verdict = evaluateStart(
      ymdAtLocalMinutes(DAY, 11 * 60),
      60,
      cfg,
      busy,
      EARLY
    );
    expect(verdict).toMatchObject({ ok: false, reason: "CAPACITY" });
    if (!verdict.ok) {
      expect(verdict.message).toContain("Rocky");
      expect(verdict.conflicts).toHaveLength(1);
    }
  });

  it("con maxConcurrentBaths 2 tolera un traslape", () => {
    const busy = [busyAt(10 * 60, 120)];
    const verdict = evaluateStart(
      ymdAtLocalMinutes(DAY, 11 * 60),
      60,
      { ...cfg, maxConcurrentBaths: 2 },
      busy,
      EARLY
    );
    expect(verdict.ok).toBe(true);
  });
});

describe("chainStarts (multi-perro)", () => {
  it("cada perro empieza cuando termina el anterior más el buffer", () => {
    const start = ymdAtLocalMinutes(DAY, 10 * 60);
    const starts = chainStarts(start, [60, 90, 45], 15);
    expect(starts.map(localMinutesOfDay)).toEqual([
      10 * 60, // 10:00
      11 * 60 + 15, // 11:15 (10:00 + 60 + 15)
      12 * 60 + 60, // 13:00 (11:15 + 90 + 15)
    ]);
  });

  it("sin buffer encadena espalda con espalda", () => {
    const start = ymdAtLocalMinutes(DAY, 9 * 60);
    const starts = chainStarts(start, [60, 60], 0);
    expect(starts.map(localMinutesOfDay)).toEqual([9 * 60, 10 * 60]);
  });
});

describe("formatos para mensajes del equipo", () => {
  it("formatLocalTime habla en hora del hotel con am/pm", () => {
    expect(formatLocalTime(ymdAtLocalMinutes(DAY, 9 * 60 + 30))).toBe("9:30 am");
    expect(formatLocalTime(ymdAtLocalMinutes(DAY, 12 * 60))).toBe("12:00 pm");
    expect(formatLocalTime(ymdAtLocalMinutes(DAY, 0))).toBe("12:00 am");
    expect(formatLocalTime(ymdAtLocalMinutes(DAY, 17 * 60 + 5))).toBe("5:05 pm");
  });

  it("formatDuration compone horas y minutos", () => {
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(60)).toBe("1 h");
    expect(formatDuration(90)).toBe("1 h 30 min");
  });
});
