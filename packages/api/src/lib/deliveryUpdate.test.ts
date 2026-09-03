import { describe, expect, it, vi, beforeEach } from "vitest";

// reservationAdminOps → refund.ts instancia Stripe al cargar; aquí no hay red.
vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(() => ({ refunds: { create: vi.fn() } })),
}));
vi.mock("./notify", () => ({
  notifyUser: vi.fn(async () => ({})),
  notifyUsers: vi.fn(async () => 0),
  notifyPetAudience: vi.fn(async () => 0),
  notifyTeamReservationUpdated: vi.fn(async () => undefined),
}));
vi.mock("./delivery", () => ({
  quoteDelivery: vi.fn(async () => ({ active: true, distanceKm: 6.4, fee: 250 })),
}));

import { quoteDelivery } from "./delivery";
import { notifyUser, notifyTeamReservationUpdated } from "./notify";
import { applyDeliveryUpdate } from "./deliveryUpdate";

type Db = Parameters<typeof applyDeliveryUpdate>[0];

const reservaFake = (over: Record<string, unknown> = {}) => ({
  id: "res_1",
  ownerId: "usr_owner",
  petId: "pet_1",
  groupId: null,
  staffId: null,
  status: "CONFIRMED",
  totalAmount: 1000,
  homeDelivery: false,
  homeDeliveryFee: null,
  pet: { name: "Molly" },
  payments: [],
  ...over,
});

const prismaFake = (
  reserva: Record<string, unknown> | null,
  opciones: {
    hermana?: Record<string, unknown> | null;
    pendiente?: Record<string, unknown> | null;
    onUpdate?: (data: Record<string, unknown>) => void;
  } = {}
) =>
  ({
    reservation: {
      findUnique: async () => reserva,
      findFirst: async () => opciones.hermana ?? null,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        opciones.onUpdate?.(data);
        return {};
      },
    },
    reservationChangeRequest: { findFirst: async () => opciones.pendiente ?? null },
  }) as unknown as Db;

const ALTA = { enable: true as const, address: "Calle 1 #2", lat: 29.1, lng: -110.9 };

beforeEach(() => {
  vi.mocked(quoteDelivery).mockClear();
  vi.mocked(quoteDelivery).mockResolvedValue({ active: true, distanceKm: 6.4, fee: 250 });
  vi.mocked(notifyUser).mockClear();
  vi.mocked(notifyTeamReservationUpdated).mockClear();
});

describe("applyDeliveryUpdate — alta del domicilio", () => {
  it("recotiza server-side, suma la tarifa al total y avisa al dueño y al equipo", async () => {
    let escrito: Record<string, unknown> | null = null;
    const prisma = prismaFake(reservaFake(), { onUpdate: (d) => (escrito = d) });
    const res = await applyDeliveryUpdate(prisma, {
      reservationId: "res_1",
      input: ALTA,
      isStaffOrAdmin: true,
      actorUserId: "usr_web",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.fee).toBe(250);
    expect(res.data.delta).toBe(250);
    expect(res.data.newTotal).toBe(1250);
    expect(escrito!.homeDelivery).toBe(true);
    expect(String(escrito!.totalAmount)).toBe("1250");
    expect(vi.mocked(notifyUser)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notifyTeamReservationUpdated)).toHaveBeenCalledTimes(1);
  });

  it("cambiar de dirección cobra solo la DIFERENCIA contra la tarifa guardada", async () => {
    const prisma = prismaFake(
      reservaFake({ homeDelivery: true, homeDeliveryFee: 200, totalAmount: 1200 })
    );
    const res = await applyDeliveryUpdate(prisma, {
      reservationId: "res_1",
      input: ALTA,
      isStaffOrAdmin: true,
      actorUserId: "usr_web",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.delta).toBe(50);
    expect(res.data.newTotal).toBe(1250);
  });

  it("feeOverride del panel pisa la cotización por distancia", async () => {
    let escrito: Record<string, unknown> | null = null;
    const prisma = prismaFake(reservaFake(), { onUpdate: (d) => (escrito = d) });
    const res = await applyDeliveryUpdate(prisma, {
      reservationId: "res_1",
      input: { ...ALTA, feeOverride: 400 },
      isStaffOrAdmin: true,
      actorUserId: "usr_web",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.fee).toBe(400);
    expect(res.data.newTotal).toBe(1400);
    // La distancia sigue siendo la real: el override es del precio, no del mapa.
    expect(escrito!.homeDeliveryDistanceKm).toBe(6.4);
  });

  it("un feeOverride mandado por el DUEÑO se ignora (gana la cotización)", async () => {
    const prisma = prismaFake(reservaFake());
    const res = await applyDeliveryUpdate(prisma, {
      reservationId: "res_1",
      input: { ...ALTA, feeOverride: 1 },
      isStaffOrAdmin: false,
      actorUserId: "usr_owner",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.fee).toBe(250);
  });

  it("la cortesía le gana al feeOverride: el viaje se registra en $0", async () => {
    const prisma = prismaFake(reservaFake());
    const res = await applyDeliveryUpdate(prisma, {
      reservationId: "res_1",
      input: { ...ALTA, isCourtesy: true, feeOverride: 400 },
      isStaffOrAdmin: true,
      actorUserId: "usr_web",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.isCourtesy).toBe(true);
    expect(res.data.fee).toBe(0);
    expect(res.data.newTotal).toBe(1000);
  });

  it("la cortesía mandada por el DUEÑO se ignora: se cobra igual", async () => {
    const prisma = prismaFake(reservaFake());
    const res = await applyDeliveryUpdate(prisma, {
      reservationId: "res_1",
      input: { ...ALTA, isCourtesy: true },
      isStaffOrAdmin: false,
      actorUserId: "usr_owner",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.isCourtesy).toBe(false);
    expect(res.data.fee).toBe(250);
  });

  it("ROUND_TRIP se le pasa a la cotización tal cual", async () => {
    const prisma = prismaFake(reservaFake());
    await applyDeliveryUpdate(prisma, {
      reservationId: "res_1",
      input: { ...ALTA, trip: "ROUND_TRIP" },
      isStaffOrAdmin: true,
      actorUserId: "usr_web",
    });
    expect(vi.mocked(quoteDelivery).mock.calls[0][3]).toBe("ROUND_TRIP");
  });

  it("servicio desactivado: 400 sin tarifa manual…", async () => {
    vi.mocked(quoteDelivery).mockResolvedValue({ active: false, distanceKm: 0, fee: 0 });
    const prisma = prismaFake(reservaFake());
    const res = await applyDeliveryUpdate(prisma, {
      reservationId: "res_1",
      input: ALTA,
      isStaffOrAdmin: true,
      actorUserId: "usr_web",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
    expect(res.code).toBe("DELIVERY_INACTIVE");
  });

  it("…pero con tarifa manual el viaje pactado sí se registra", async () => {
    vi.mocked(quoteDelivery).mockResolvedValue({ active: false, distanceKm: 0, fee: 0 });
    let escrito: Record<string, unknown> | null = null;
    const prisma = prismaFake(reservaFake(), { onUpdate: (d) => (escrito = d) });
    const res = await applyDeliveryUpdate(prisma, {
      reservationId: "res_1",
      input: { ...ALTA, feeOverride: 350 },
      isStaffOrAdmin: true,
      actorUserId: "usr_web",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.fee).toBe(350);
    expect(escrito!.homeDeliveryDistanceKm).toBeNull();
  });

  it("en un grupo, si otra hermana ya trae el domicilio manda 409 con su fila", async () => {
    const prisma = prismaFake(reservaFake({ groupId: "g1" }), {
      hermana: { id: "res_2", pet: { name: "Bailey" } },
    });
    const res = await applyDeliveryUpdate(prisma, {
      reservationId: "res_1",
      input: ALTA,
      isStaffOrAdmin: true,
      actorUserId: "usr_web",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(409);
    expect(res.code).toBe("DELIVERY_ON_SIBLING");
    expect(res.error).toContain("Bailey");
    expect(res.extra).toEqual({ siblingReservationId: "res_2" });
  });
});

describe("applyDeliveryUpdate — quitar el domicilio", () => {
  it("descuenta la tarifa GUARDADA, no una recotización", async () => {
    vi.mocked(quoteDelivery).mockResolvedValue({ active: true, distanceKm: 6.4, fee: 999 });
    let escrito: Record<string, unknown> | null = null;
    const prisma = prismaFake(
      reservaFake({ homeDelivery: true, homeDeliveryFee: 200, totalAmount: 1200 }),
      { onUpdate: (d) => (escrito = d) }
    );
    const res = await applyDeliveryUpdate(prisma, {
      reservationId: "res_1",
      input: { enable: false },
      isStaffOrAdmin: true,
      actorUserId: "usr_web",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.delta).toBe(-200);
    expect(res.data.newTotal).toBe(1000);
    expect(escrito!.homeDelivery).toBe(false);
    expect(escrito!.homeDeliveryAddress).toBeNull();
  });

  it("quitar lo que no existe es 400, no un total negativo", async () => {
    const prisma = prismaFake(reservaFake());
    const res = await applyDeliveryUpdate(prisma, {
      reservationId: "res_1",
      input: { enable: false },
      isStaffOrAdmin: true,
      actorUserId: "usr_web",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("NO_DELIVERY");
  });
});

describe("applyDeliveryUpdate — candados", () => {
  it("404 si la reserva no existe", async () => {
    const res = await applyDeliveryUpdate(prismaFake(null), {
      reservationId: "res_zzz",
      input: ALTA,
      isStaffOrAdmin: true,
      actorUserId: "usr_web",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(404);
  });

  it("`authorize` que dice que no ⇒ 403 y no escribe nada", async () => {
    let escrito = false;
    const prisma = prismaFake(reservaFake(), { onUpdate: () => (escrito = true) });
    const res = await applyDeliveryUpdate(prisma, {
      reservationId: "res_1",
      input: ALTA,
      isStaffOrAdmin: false,
      actorUserId: "usr_ajeno",
      authorize: () => false,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(403);
    expect(escrito).toBe(false);
  });

  it.each([["CANCELLED"], ["CHECKED_OUT"]])("%s ya no se modifica", async (status) => {
    const prisma = prismaFake(reservaFake({ status }));
    const res = await applyDeliveryUpdate(prisma, {
      reservationId: "res_1",
      input: ALTA,
      isStaffOrAdmin: true,
      actorUserId: "usr_web",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("NOT_ACTIVE");
  });

  it("el dueño no lo cambia con la estancia en curso; el equipo sí", async () => {
    const prisma = prismaFake(reservaFake({ status: "CHECKED_IN" }));
    const delDueno = await applyDeliveryUpdate(prisma, {
      reservationId: "res_1",
      input: ALTA,
      isStaffOrAdmin: false,
      actorUserId: "usr_owner",
    });
    expect(delDueno.ok).toBe(false);
    if (!delDueno.ok) expect(delDueno.code).toBe("NOT_CONFIRMED");

    const delEquipo = await applyDeliveryUpdate(prisma, {
      reservationId: "res_1",
      input: ALTA,
      isStaffOrAdmin: true,
      actorUserId: "usr_web",
    });
    expect(delEquipo.ok).toBe(true);
  });

  it("una solicitud de cambio PENDING bloquea tocar el total", async () => {
    const prisma = prismaFake(reservaFake(), { pendiente: { id: "cr_1" } });
    const res = await applyDeliveryUpdate(prisma, {
      reservationId: "res_1",
      input: ALTA,
      isStaffOrAdmin: true,
      actorUserId: "usr_web",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(409);
    expect(res.code).toBe("PENDING_CHANGE_REQUEST");
  });

  it("no avisa al DUEÑO cuando el cambio lo hace él mismo", async () => {
    const prisma = prismaFake(reservaFake());
    await applyDeliveryUpdate(prisma, {
      reservationId: "res_1",
      input: ALTA,
      isStaffOrAdmin: false,
      actorUserId: "usr_owner",
    });
    expect(vi.mocked(notifyUser)).not.toHaveBeenCalled();
  });

  it("reporta el sobrepago cuando el total baja por debajo de lo ya pagado", async () => {
    const prisma = prismaFake(
      reservaFake({
        homeDelivery: true,
        homeDeliveryFee: 300,
        totalAmount: 1300,
        payments: [{ amount: 1300, status: "PAID" }],
      })
    );
    const res = await applyDeliveryUpdate(prisma, {
      reservationId: "res_1",
      input: { enable: false },
      isStaffOrAdmin: true,
      actorUserId: "usr_web",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.overpaid).toBe(300);
  });
});
