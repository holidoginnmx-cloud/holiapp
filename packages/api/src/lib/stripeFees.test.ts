/**
 * Tests de la comisión de Stripe por cobro.
 *
 * Todo lo que se cubre aquí falla EN SILENCIO, que es lo peligroso: un pago sin
 * `stripeFeeAmount` no revienta nada, simplemente hace que los ingresos cuenten
 * el BRUTO y el dueño vea pesos que nunca le cayeron. Y confundir "Stripe aún
 * no publica la comisión" con "este cobro no tiene comisión" congelaría ese
 * error para siempre, porque nadie volvería a preguntar.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Stripe from "stripe";

// El cliente Stripe se crea perezosamente dentro del módulo, así que el mock
// tiene que existir antes de importarlo. `retrieveImpl` es mutable para que
// cada test decida qué contesta Stripe.
const { retrieveImpl } = vi.hoisted(() => ({
  retrieveImpl: { fn: (_id: string) => Promise.resolve({} as unknown) },
}));

vi.mock("stripe", () => ({
  default: class {
    paymentIntents = { retrieve: (id: string) => retrieveImpl.fn(id) };
  },
}));

import {
  esPaymentIntentReal,
  leerComisionStripe,
  syncPendingStripeFees,
} from "./stripeFees";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** PaymentIntent con su charge y balance_transaction ya expandidos. */
function piConComision(feeCents: number | null, availableOn: number | null = 1_757_462_400) {
  return {
    id: "pi_test",
    latest_charge: {
      id: "ch_test",
      balance_transaction: {
        id: "txn_test",
        fee: feeCents,
        available_on: availableOn,
      },
    },
  } as unknown as Stripe.PaymentIntent;
}

type PagoFake = {
  id: string;
  amount: number;
  stripePaymentIntentId: string | null;
};

function prismaFake(pagos: PagoFake[], onUpdate?: (args: Record<string, unknown>) => void) {
  const updates: { id: string; data: Record<string, unknown> }[] = [];
  return {
    prisma: {
      payment: {
        findMany: () => Promise.resolve(pagos),
        update: (args: { where: { id: string }; data: Record<string, unknown> }) => {
          updates.push({ id: args.where.id, data: args.data });
          onUpdate?.(args);
          return Promise.resolve({});
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    updates,
  };
}

beforeEach(() => {
  retrieveImpl.fn = () => Promise.reject(new Error("sin red en tests"));
});

// ─────────────────────────────────────────────────────────────────────────────
//  esPaymentIntentReal
// ─────────────────────────────────────────────────────────────────────────────
//
// Los reembolsos se guardan en la MISMA columna que los cobros, con un id que
// no es un PaymentIntent. Pedírselo a Stripe devuelve 404, y sin este filtro
// cada corrida del cron acumularía errores falsos que esconden los de verdad.

describe("esPaymentIntentReal", () => {
  it("acepta un PaymentIntent normal", () => {
    expect(esPaymentIntentReal("pi_3UCQtfP7i6KONRYs0lzKZhJ8")).toBe(true);
  });

  it("rechaza el id de un refund de Stripe", () => {
    expect(esPaymentIntentReal("re_3UBMCnP7i6KONRYs0j7atM6j")).toBe(false);
  });

  it("rechaza el id sintético de un refund propio", () => {
    expect(esPaymentIntentReal("pi_3UBMCn_refund_ch_3UBMCn")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  leerComisionStripe
// ─────────────────────────────────────────────────────────────────────────────

describe("leerComisionStripe", () => {
  it("convierte los centavos de la comisión a pesos", async () => {
    // El caso real: cobro de $1,050.00 con comisión de $47.33 → neto $1,002.67.
    retrieveImpl.fn = () => Promise.resolve(piConComision(4733));

    const res = await leerComisionStripe("pi_test");

    expect(res).not.toBeNull();
    expect(res!.fee.toString()).toBe("47.33");
  });

  it("devuelve la fecha en que Stripe libera el dinero", async () => {
    retrieveImpl.fn = () => Promise.resolve(piConComision(4733, 1_757_462_400));

    const res = await leerComisionStripe("pi_test");

    expect(res!.availableOn).toEqual(new Date(1_757_462_400 * 1000));
  });

  it("devuelve null —no cero— cuando el balance_transaction aún no trae fee", async () => {
    // Pasa con tarjeta MXN: el bt viene `pending`. Escribir 0 aquí congelaría
    // el ingreso en bruto para siempre, porque el pago dejaría de ser candidato.
    retrieveImpl.fn = () => Promise.resolve(piConComision(null));

    expect(await leerComisionStripe("pi_test")).toBeNull();
  });

  it("devuelve null cuando el balance_transaction no viene expandido", async () => {
    retrieveImpl.fn = () =>
      Promise.resolve({
        id: "pi_test",
        latest_charge: { id: "ch_test", balance_transaction: "txn_sin_expandir" },
      } as unknown as Stripe.PaymentIntent);

    expect(await leerComisionStripe("pi_test")).toBeNull();
  });

  it("devuelve null cuando el PaymentIntent no tiene charge", async () => {
    retrieveImpl.fn = () =>
      Promise.resolve({ id: "pi_test", latest_charge: null } as unknown as Stripe.PaymentIntent);

    expect(await leerComisionStripe("pi_test")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  syncPendingStripeFees
// ─────────────────────────────────────────────────────────────────────────────

describe("syncPendingStripeFees", () => {
  it("guarda la comisión y reporta el neto", async () => {
    retrieveImpl.fn = () => Promise.resolve(piConComision(4733));
    const { prisma, updates } = prismaFake([
      { id: "pay_1", amount: 1050, stripePaymentIntentId: "pi_test" },
    ]);

    const res = await syncPendingStripeFees(prisma);

    expect(res.actualizados).toBe(1);
    expect(res.pendientes).toBe(0);
    expect(updates).toHaveLength(1);
    expect(String(updates[0].data.stripeFeeAmount)).toBe("47.33");
    expect(res.detalle[0].neto).toBe("1002.67");
  });

  it("no escribe nada cuando Stripe aún no publica la comisión", async () => {
    retrieveImpl.fn = () => Promise.resolve(piConComision(null));
    const { prisma, updates } = prismaFake([
      { id: "pay_1", amount: 1050, stripePaymentIntentId: "pi_test" },
    ]);

    const res = await syncPendingStripeFees(prisma);

    expect(res.pendientes).toBe(1);
    expect(res.actualizados).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it("salta los refunds sin llamar a Stripe", async () => {
    let llamadas = 0;
    retrieveImpl.fn = () => {
      llamadas++;
      return Promise.reject(new Error("no debió llamarse"));
    };
    const { prisma } = prismaFake([
      { id: "pay_refund", amount: 180, stripePaymentIntentId: "re_3UBMCn" },
    ]);

    const res = await syncPendingStripeFees(prisma);

    expect(llamadas).toBe(0);
    expect(res.revisados).toBe(0);
    expect(res.errores).toBe(0);
  });

  it("un cobro que falla no tumba los demás", async () => {
    retrieveImpl.fn = (id: string) =>
      id === "pi_malo"
        ? Promise.reject(new Error("No such payment_intent"))
        : Promise.resolve(piConComision(4733));
    const { prisma, updates } = prismaFake([
      { id: "pay_malo", amount: 100, stripePaymentIntentId: "pi_malo" },
      { id: "pay_bueno", amount: 1050, stripePaymentIntentId: "pi_bueno" },
    ]);

    const res = await syncPendingStripeFees(prisma);

    expect(res.errores).toBe(1);
    expect(res.actualizados).toBe(1);
    expect(updates.map((u) => u.id)).toEqual(["pay_bueno"]);
  });
});
