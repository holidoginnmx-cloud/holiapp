import { describe, expect, it, vi } from "vitest";

import {
  buildNewOrderMessage,
  buildPendingOrdersMessage,
  sendPendingStoreOrderReminders,
} from "./storeOrderAlerts";

vi.mock("./notify", () => ({
  adminsActivosIds: vi.fn(async () => ["admin_1", "admin_2"]),
  notifyUsers: vi.fn(async () => 2),
}));

/** Instante real a una hora local del hotel (UTC-7 fijo). */
const hotelTime = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00.000-07:00`);

describe("buildNewOrderMessage", () => {
  it("dice qué se vendió y que hay que mandarlo (caso del pedido #8)", () => {
    const msg = buildNewOrderMessage({
      orderNumber: 8,
      total: 310,
      fulfillmentType: "NATIONAL_SHIPPING",
      items: [{ name: "Pelota de Tenis Grande con Squeaker", quantity: 1 }],
      customer: "rudechktf@gmail.com",
    });
    expect(msg.title).toBe("🛍️ Venta en la tienda: $310");
    expect(msg.body).toContain("Pedido #8 · rudechktf@gmail.com: Pelota de Tenis Grande con Squeaker.");
    expect(msg.body).toContain("Envío nacional: hay que mandarlo y capturar la guía");
  });

  it("resume a partir del tercer artículo y marca cantidades", () => {
    const msg = buildNewOrderMessage({
      orderNumber: 9,
      total: 1250.5,
      fulfillmentType: "PICKUP",
      items: [
        { name: "Collar", quantity: 2 },
        { name: "Correa", quantity: 1 },
        { name: "Shampoo", quantity: 1 },
        { name: "Premios", quantity: 3 },
      ],
      customer: null,
    });
    expect(msg.title).toBe("🛍️ Venta en la tienda: $1,250.5");
    expect(msg.body).toContain("Pedido #9: 2× Collar, Correa y 2 más.");
    expect(msg.body).toContain("Lo recoge en el hotel");
  });
});

describe("buildPendingOrdersMessage", () => {
  // Pagado a las 00:36 del 19 (07:36 UTC). A las 21:00 del 19 en el hotel ya es
  // el 20 en UTC: si el día se leyera en UTC diría "ayer".
  const paidAt = new Date("2026-10-19T07:36:01Z");

  it("cuenta los días en hora del hotel, también de noche", () => {
    const msg = buildPendingOrdersMessage(
      [{ orderNumber: 8, fulfillmentType: "NATIONAL_SHIPPING", paidAt }],
      hotelTime("2026-10-19", "20:30")
    );
    expect(msg.title).toBe("📦 Tienes 1 pedido de la tienda sin enviar");
    expect(msg.body).toContain("#8 · envío nacional · pagado hoy");
    expect(msg.body).toContain("captura la guía");
  });

  it("al día siguiente dice ayer, y varios pedidos van en una sola línea cada uno", () => {
    const msg = buildPendingOrdersMessage(
      [
        { orderNumber: 8, fulfillmentType: "NATIONAL_SHIPPING", paidAt },
        { orderNumber: 9, fulfillmentType: "PICKUP", paidAt: hotelTime("2026-10-17", "12:00") },
      ],
      hotelTime("2026-10-20", "09:10")
    );
    expect(msg.title).toBe("📦 Tienes 2 pedidos de la tienda pendientes");
    expect(msg.body).toContain("#8 · envío nacional · pagado ayer");
    expect(msg.body).toContain("#9 · recoge en el hotel · pagado hace 3 días");
  });

  it("sin envíos, pide marcarlo como entregado", () => {
    const msg = buildPendingOrdersMessage(
      [{ orderNumber: 10, fulfillmentType: "LOCAL_DELIVERY", paidAt }],
      hotelTime("2026-10-19", "10:00")
    );
    expect(msg.title).toBe("📦 Tienes 1 pedido de la tienda sin entregar");
    expect(msg.body).toContain("«Entregado»");
  });
});

describe("sendPendingStoreOrderReminders", () => {
  const pending = [
    { orderNumber: 8, fulfillmentType: "NATIONAL_SHIPPING", paidAt: new Date("2026-10-19T07:36:01Z") },
  ];
  const fakePrisma = (opts: { yaAvisado?: boolean; rows?: unknown[] } = {}) =>
    ({
      notification: { findFirst: vi.fn(async () => (opts.yaAvisado ? { id: "n1" } : null)) },
      order: { findMany: vi.fn(async () => opts.rows ?? pending) },
    }) as never;

  it("no avisa de madrugada", async () => {
    const r = await sendPendingStoreOrderReminders(fakePrisma(), hotelTime("2026-10-20", "06:00"));
    expect(r.sent).toBe(0);
  });

  it("avisa una vez al día desde las 9:00", async () => {
    expect((await sendPendingStoreOrderReminders(fakePrisma(), hotelTime("2026-10-20", "09:05"))).sent).toBe(2);
    expect(
      (await sendPendingStoreOrderReminders(fakePrisma({ yaAvisado: true }), hotelTime("2026-10-20", "09:15"))).sent
    ).toBe(0);
  });

  it("sin pedidos pendientes no manda nada", async () => {
    const r = await sendPendingStoreOrderReminders(fakePrisma({ rows: [] }), hotelTime("2026-10-20", "10:00"));
    expect(r.sent).toBe(0);
  });
});
