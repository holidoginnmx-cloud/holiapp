import { describe, expect, it } from "vitest";
import {
  addDaysYMD,
  describeRecurrence,
  hotelTodayYMD,
  isYMD,
  matchesRule,
  mondayOfYMD,
  nextOccurrences,
  occurrencesBetween,
  recurringBookingIssues,
  shortDateLabelES,
  weekdayOfDateYMD,
} from "./recurrence";
import { CreateRecurringBookingSchema, UpdateRecurringBookingSchema } from "./index";

// Caso real: los Gurrola, un viernes sí y uno no, desde el viernes 27-nov-2026.
const GURROLA = { intervalWeeks: 2, weekdays: [5], anchorDate: "2026-11-27" };

describe("calendario de días", () => {
  it("valida fechas reales", () => {
    expect(isYMD("2026-11-27")).toBe(true);
    expect(isYMD("2026-02-30")).toBe(false);
    expect(isYMD("2026-1-5")).toBe(false);
  });

  it("día de la semana sin depender de la zona del proceso", () => {
    expect(weekdayOfDateYMD("2026-11-27")).toBe(5); // viernes
    expect(weekdayOfDateYMD("2026-11-29")).toBe(0); // domingo
  });

  it("lunes de la semana (domingo pertenece a la semana que empezó el lunes anterior)", () => {
    expect(mondayOfYMD("2026-11-27")).toBe("2026-11-23");
    expect(mondayOfYMD("2026-11-29")).toBe("2026-11-23");
    expect(mondayOfYMD("2026-11-30")).toBe("2026-11-30");
  });

  it("suma días cruzando mes y año", () => {
    expect(addDaysYMD("2026-12-25", 14)).toBe("2027-01-08");
  });

  it("hoy en el hotel: después de las 5 pm de Hermosillo el UTC ya es mañana", () => {
    // 2026-11-20 18:00 en Hermosillo = 2026-11-21 01:00Z
    expect(hotelTodayYMD(new Date("2026-11-21T01:00:00Z"))).toBe("2026-11-20");
    expect(hotelTodayYMD(new Date("2026-11-21T07:00:00Z"))).toBe("2026-11-21");
  });
});

describe("cada 2 semanas", () => {
  it("un viernes sí y uno no, cruzando el año", () => {
    expect(occurrencesBetween(GURROLA, "2026-11-01", "2027-01-31")).toEqual([
      "2026-11-27",
      "2026-12-11",
      "2026-12-25",
      "2027-01-08",
      "2027-01-22",
    ]);
  });

  it("el viernes de la semana impar no cae", () => {
    expect(matchesRule(GURROLA, "2026-12-04")).toBe(false);
    expect(matchesRule(GURROLA, "2026-12-11")).toBe(true);
  });

  it("nada antes de la primera fecha", () => {
    expect(matchesRule(GURROLA, "2026-11-13")).toBe(false);
  });

  it("respeta la fecha final (incluida) y las fechas saltadas", () => {
    const rule = { ...GURROLA, endDate: "2026-12-25", skipDates: ["2026-12-11"] };
    expect(occurrencesBetween(rule, "2026-11-01", "2027-03-01")).toEqual([
      "2026-11-27",
      "2026-12-25",
    ]);
  });

  it("la paridad sale de la SEMANA del ancla, no del día", () => {
    // Ancla en miércoles con días lun y vie: la semana del ancla cuenta,
    // pero el lunes anterior al ancla no.
    const rule = { intervalWeeks: 2, weekdays: [1, 5], anchorDate: "2026-11-25" };
    expect(occurrencesBetween(rule, "2026-11-23", "2026-12-11")).toEqual([
      "2026-11-27",
      "2026-12-07",
      "2026-12-11",
    ]);
  });
});

describe("guardería varios días por semana", () => {
  it("lun, mié y vie cada semana", () => {
    const rule = { intervalWeeks: 1, weekdays: [1, 3, 5], anchorDate: "2026-11-23" };
    expect(occurrencesBetween(rule, "2026-11-23", "2026-11-29")).toEqual([
      "2026-11-23",
      "2026-11-25",
      "2026-11-27",
    ]);
  });
});

describe("próximas fechas y textos", () => {
  it("nextOccurrences junta varias ventanas", () => {
    const rule = { intervalWeeks: 4, weekdays: [5], anchorDate: "2026-11-27" };
    expect(nextOccurrences(rule, "2026-11-18", 3)).toEqual([
      "2026-11-27",
      "2026-12-25",
      "2027-01-22",
    ]);
  });

  it("nextOccurrences se detiene en la fecha final", () => {
    expect(nextOccurrences({ ...GURROLA, endDate: "2026-12-12" }, "2026-11-18", 5)).toEqual([
      "2026-11-27",
      "2026-12-11",
    ]);
  });

  it("describe la regla como la dice el equipo", () => {
    expect(describeRecurrence(GURROLA)).toBe("Cada 2 semanas · viernes");
    expect(describeRecurrence({ intervalWeeks: 1, weekdays: [5, 1, 3] })).toBe(
      "Cada semana · lun, mié y vie"
    );
    expect(describeRecurrence({ intervalWeeks: 1, weekdays: [0, 6] })).toBe(
      "Cada semana · sáb y dom"
    );
  });

  it("etiqueta corta de fecha", () => {
    expect(shortDateLabelES("2026-11-27")).toBe("vie 27 nov");
  });
});

describe("validación", () => {
  const base = {
    reservationType: "BATH" as const,
    ownerId: "u1",
    petIds: ["p1", "p2", "p3"],
    intervalWeeks: 2,
    weekdays: [5],
    anchorDate: "2026-11-27",
    startTime: "10:00",
  };

  it("acepta la serie Gurrola", () => {
    expect(CreateRecurringBookingSchema.safeParse(base).success).toBe(true);
  });

  it("baño sin hora, guardería sin horario y primera fecha en otro día", () => {
    expect(recurringBookingIssues({ ...base, startTime: null })).toEqual([
      "Falta la hora de la cita de baño",
    ]);
    expect(
      recurringBookingIssues({
        ...base,
        reservationType: "DAYCARE",
        checkInTime: "15:00",
        checkOutTime: "09:00",
      })
    ).toEqual(["La salida de la guardería debe ser después de la entrada"]);
    expect(recurringBookingIssues({ ...base, anchorDate: "2026-11-26" })[0]).toMatch(/jueves/);
  });

  it("el PATCH no inventa valores para lo que no se mandó", () => {
    const parsed = UpdateRecurringBookingSchema.parse({ active: false });
    expect(parsed).toEqual({ active: false });
  });
});
