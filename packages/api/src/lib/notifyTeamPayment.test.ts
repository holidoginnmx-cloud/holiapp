import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@holidoginn/db";

import {
  buildTeamPaymentMessage,
  formatMoney,
  notifyPaymentToAdmins,
} from "./notifyTeamPayment";
import { notifyNewReservation, paidSuffix } from "./notifyNewReservation";

// Lo que estos tests cuidan es UNA regla: el dinero solo lo ven los ADMIN. El
// staff recibe el aviso de reserva nueva, pero sin monto, y ningún aviso de
// pago. Si alguien "simplifica" la audiencia, esto tiene que fallar.

type Row = { userId: string; type: string; title: string; body: string; data: unknown };

/**
 * Prisma de mentira con lo mínimo que tocan los avisos. Sin tokens de push:
 * así no se llama a Expo y solo se observan las filas de `notifications`.
 */
function fakePrisma(team: { id: string; role: "ADMIN" | "STAFF"; isActive?: boolean }[]) {
  const rows: Row[] = [];
  const prisma = {
    user: {
      findMany: async ({ where }: { where: { role: unknown; isActive?: boolean } }) => {
        const roles =
          typeof where.role === "string"
            ? [where.role]
            : (where.role as { in: string[] }).in;
        return team
          .filter((u) => roles.includes(u.role) && (u.isActive ?? true))
          .map((u) => ({ id: u.id }));
      },
    },
    notification: {
      createMany: async ({ data }: { data: Row[] }) => {
        rows.push(...data);
        return { count: data.length };
      },
    },
    pushToken: { findMany: async () => [] },
    reservation: {
      findUnique: async () => ({ reservationType: "STAY", pet: { name: "Molly" } }),
    },
  };
  return { prisma: prisma as unknown as PrismaClient, rows };
}

const team = [
  { id: "admin_jessica", role: "ADMIN" as const },
  { id: "admin_javier", role: "ADMIN" as const },
  { id: "staff_nancy", role: "STAFF" as const },
  { id: "admin_baja", role: "ADMIN" as const, isActive: false },
];

const stay = {
  id: "res_1",
  reservationType: "STAY",
  checkIn: new Date("2026-11-20T00:00:00.000Z"),
  checkOut: new Date("2026-11-23T00:00:00.000Z"),
  totalDays: 3,
  pet: { name: "Molly" },
  room: { name: "Cuarto 01" },
};
const owner = { firstName: "Ana", lastName: "Ruiz" };
// Lejos del check-in: variante no urgente, texto estable.
const now = new Date("2026-10-01T18:00:00.000Z");

describe("formatMoney", () => {
  it("no pinta centavos cuando no los hay y sí cuando existen", () => {
    expect(formatMoney(1200)).toBe("$1,200");
    expect(formatMoney(1200.5)).toBe("$1,200.5");
    expect(formatMoney(349.99)).toBe("$349.99");
  });
});

describe("paidSuffix", () => {
  it("distingue anticipo de pago total", () => {
    expect(paidSuffix({ amount: 500, kind: "DEPOSIT" })).toBe(" · Anticipo $500 pagado");
    expect(paidSuffix({ amount: 2500, kind: "FULL" })).toBe(" · Pagado $2,500");
  });

  it("sin pago (o en ceros) no agrega nada", () => {
    expect(paidSuffix(null)).toBe("");
    expect(paidSuffix(undefined)).toBe("");
    expect(paidSuffix({ amount: 0, kind: "FULL" })).toBe("");
  });
});

describe("notifyNewReservation — monto pagado", () => {
  it("el monto va solo a los ADMIN; al staff le llega el texto sin dinero", async () => {
    const { prisma, rows } = fakePrisma(team);
    await notifyNewReservation(prisma, {
      reservations: [stay],
      owner,
      source: "APP_CLIENTE",
      createdByUserId: "cliente_1",
      paid: { amount: 500, kind: "DEPOSIT" },
      now,
    });

    const byUser = new Map(rows.map((r) => [r.userId, r]));
    expect([...byUser.keys()].sort()).toEqual([
      "admin_javier",
      "admin_jessica",
      "staff_nancy",
    ]);
    expect(byUser.get("admin_jessica")?.body).toContain("Anticipo $500 pagado");
    expect(byUser.get("admin_javier")?.body).toContain("Anticipo $500 pagado");
    expect(byUser.get("staff_nancy")?.body).not.toContain("$");
    // Un solo aviso por persona: el pago NO genera un segundo push.
    expect(rows).toHaveLength(3);
  });

  it("sin `paid` todos reciben exactamente el mismo aviso de siempre", async () => {
    const { prisma, rows } = fakePrisma(team);
    await notifyNewReservation(prisma, {
      reservations: [stay],
      owner,
      source: "APP_ADMIN",
      createdByUserId: "admin_jessica",
      now,
    });

    // Quien la capturó no se avisa a sí misma.
    expect(rows.map((r) => r.userId).sort()).toEqual(["admin_javier", "staff_nancy"]);
    expect(new Set(rows.map((r) => r.body)).size).toBe(1);
    expect(rows[0]?.body).not.toContain("$");
  });
});

describe("buildTeamPaymentMessage", () => {
  it("el saldo nombra el servicio de la reserva", () => {
    expect(
      buildTeamPaymentMessage({
        amount: 1200,
        concept: "BALANCE",
        petName: "Molly",
        reservationType: "STAY",
      }),
    ).toEqual({
      title: "💰 Pago recibido · $1,200",
      body: "Saldo de la estancia de Molly. Pagó en línea con tarjeta.",
    });
    expect(
      buildTeamPaymentMessage({
        amount: 300,
        concept: "BALANCE",
        petName: "Molly",
        reservationType: "BATH",
      }).body,
    ).toContain("Saldo del baño de Molly");
    expect(
      buildTeamPaymentMessage({
        amount: 300,
        concept: "BALANCE",
        petName: "Molly",
        reservationType: "DAYCARE",
      }).body,
    ).toContain("Saldo de la guardería de Molly");
  });

  it("cubre los demás conceptos y aguanta una reserva sin mascota", () => {
    expect(
      buildTeamPaymentMessage({ amount: 250, concept: "BATH_EXTRAS", petName: "Loki" }).body,
    ).toContain("Extras del baño de Loki");
    expect(
      buildTeamPaymentMessage({ amount: 400, concept: "BATH_ADDON", petName: "Loki" }).body,
    ).toContain("Baño agregado a la estancia de Loki");
    expect(
      buildTeamPaymentMessage({ amount: 900, concept: "EXTENSION", petName: null }).body,
    ).toContain("Extensión de la estancia de una mascota");
  });
});

describe("notifyPaymentToAdmins", () => {
  it("avisa solo a los ADMIN activos, con la reserva para el deep link", async () => {
    const { prisma, rows } = fakePrisma(team);
    await notifyPaymentToAdmins(prisma, {
      reservationId: "res_1",
      amount: 1200,
      concept: "BALANCE",
    });

    expect(rows.map((r) => r.userId).sort()).toEqual(["admin_javier", "admin_jessica"]);
    expect(rows[0]?.type).toBe("PAYMENT_RECEIVED");
    expect(rows[0]?.data).toMatchObject({
      reservationId: "res_1",
      reservationType: "STAY",
      kind: "TEAM_PAYMENT",
      amount: 1200,
    });
  });

  it("no avisa por montos en cero ni lanza si la base falla", async () => {
    const { prisma, rows } = fakePrisma(team);
    await notifyPaymentToAdmins(prisma, {
      reservationId: "res_1",
      amount: 0,
      concept: "BALANCE",
    });
    expect(rows).toHaveLength(0);

    const roto = {
      user: {
        findMany: async () => {
          throw new Error("sin base");
        },
      },
    } as unknown as PrismaClient;
    await expect(
      notifyPaymentToAdmins(roto, { reservationId: "res_1", amount: 100, concept: "BALANCE" }),
    ).resolves.toBeUndefined();
  });
});
