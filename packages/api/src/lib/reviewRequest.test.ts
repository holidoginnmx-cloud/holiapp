import { beforeEach, describe, expect, it, vi } from "vitest";

type NotifyOpts = { type: string; title: string; body: string; data?: unknown };

const notifyUser = vi.fn(async (_prisma: unknown, _opts: NotifyOpts) => ({}));
vi.mock("./notify", () => ({
  notifyUser: (prisma: unknown, opts: NotifyOpts) => notifyUser(prisma, opts),
}));

/** Opciones con las que se llamó a `notifyUser` la vez `n`. */
const notifiedWith = (n = 0): NotifyOpts => notifyUser.mock.calls[n]![1];

const { requestReview } = await import("./reviewRequest");

// Lo que se rompía antes: una visita con tres perros mandaba TRES pushes
// idénticos, porque el aviso salía por reservación. Ahora la unidad es la
// visita y sale uno solo, cuando cierra la última mascota.

type Row = {
  id: string;
  groupId: string | null;
  ownerId: string;
  status: string;
  reservationType: string;
  reviewRequestedAt: Date | null;
  pet: { name: string };
};

/** Prisma de mentiras con lo mínimo que toca `requestReview`. */
function fakePrisma(rows: Row[], reviews: { reservationId: string; groupKey: string | null }[] = []) {
  const updated: { ids: string[]; at: Date }[] = [];
  return {
    updated,
    rows,
    reservation: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        rows.find((r) => r.id === where.id) ?? null,
      findMany: async ({ where }: { where: { groupId: string; ownerId: string } }) =>
        rows.filter(
          (r) => r.groupId === where.groupId && r.ownerId === where.ownerId,
        ),
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: { in: string[] } };
        data: { reviewRequestedAt: Date };
      }) => {
        updated.push({ ids: where.id.in, at: data.reviewRequestedAt });
        for (const r of rows) {
          if (where.id.in.includes(r.id)) r.reviewRequestedAt = data.reviewRequestedAt;
        }
        return { count: where.id.in.length };
      },
    },
    review: {
      findFirst: async ({
        where,
      }: {
        where: { OR: [{ groupKey: string }, { reservationId: { in: string[] } }] };
      }) => {
        const [{ groupKey }, { reservationId }] = where.OR;
        return (
          reviews.find(
            (rev) =>
              rev.groupKey === groupKey || reservationId.in.includes(rev.reservationId),
          ) ?? null
        );
      },
    },
  };
}

const row = (over: Partial<Row> = {}): Row => ({
  id: "res_1",
  groupId: null,
  ownerId: "user_1",
  status: "CHECKED_OUT",
  reservationType: "STAY",
  reviewRequestedAt: null,
  pet: { name: "Loki" },
  ...over,
});

beforeEach(() => notifyUser.mockClear());

describe("requestReview", () => {
  it("pide reseña de una reservación suelta ya finalizada", async () => {
    const db = fakePrisma([row()]);

    expect(await requestReview(db as never, "res_1")).toBe(true);
    expect(notifyUser).toHaveBeenCalledTimes(1);
    const opts = notifiedWith();
    expect(opts.type).toBe("REVIEW_REQUEST");
    expect(opts.title).toContain("Loki");
    expect(opts.title).toContain("estancia");
    expect(db.rows[0].reviewRequestedAt).not.toBeNull();
  });

  it("usa el copy del servicio: un baño no dice 'estancia'", async () => {
    const db = fakePrisma([row({ reservationType: "BATH" })]);

    await requestReview(db as never, "res_1");
    const opts = notifiedWith();
    expect(opts.title).toContain("baño");
    expect(String(opts.title)).not.toContain("estancia");
  });

  it("en un grupo, NO pide nada mientras falte una mascota por salir", async () => {
    const db = fakePrisma([
      row({ id: "res_1", groupId: "g1" }),
      row({ id: "res_2", groupId: "g1", status: "CHECKED_IN", pet: { name: "Nala" } }),
    ]);

    expect(await requestReview(db as never, "res_1")).toBe(false);
    expect(notifyUser).not.toHaveBeenCalled();
  });

  it("cuando cierra la última, manda UN solo aviso por toda la visita", async () => {
    const db = fakePrisma([
      row({ id: "res_1", groupId: "g1" }),
      row({ id: "res_2", groupId: "g1", pet: { name: "Nala" } }),
      row({ id: "res_3", groupId: "g1", pet: { name: "Rocco" } }),
    ]);

    expect(await requestReview(db as never, "res_3")).toBe(true);
    expect(notifyUser).toHaveBeenCalledTimes(1);
    const opts = notifiedWith();
    expect(opts.title).toContain("tus peluditos");
    // Las tres quedan selladas: ninguna vuelve a disparar el aviso.
    expect(db.updated[0].ids.sort()).toEqual(["res_1", "res_2", "res_3"]);
  });

  it("con dos mascotas las nombra a las dos", async () => {
    const db = fakePrisma([
      row({ id: "res_1", groupId: "g1" }),
      row({ id: "res_2", groupId: "g1", pet: { name: "Nala" } }),
    ]);

    await requestReview(db as never, "res_1");
    const opts = notifiedWith();
    expect(opts.title).toContain("Loki y Nala");
  });

  it("ignora a las canceladas del grupo", async () => {
    const db = fakePrisma([
      row({ id: "res_1", groupId: "g1" }),
      row({ id: "res_2", groupId: "g1", status: "CANCELLED", pet: { name: "Nala" } }),
    ]);

    expect(await requestReview(db as never, "res_1")).toBe(true);
    const opts = notifiedWith();
    expect(opts.title).toContain("Loki");
    expect(db.updated[0].ids).toEqual(["res_1"]);
  });

  it("es idempotente: llamarlo de nuevo no manda un segundo push", async () => {
    const db = fakePrisma([row()]);

    expect(await requestReview(db as never, "res_1")).toBe(true);
    expect(await requestReview(db as never, "res_1")).toBe(false);
    expect(notifyUser).toHaveBeenCalledTimes(1);
  });

  it("no pide reseña de algo que ya está calificado", async () => {
    const db = fakePrisma([row()], [{ reservationId: "res_1", groupKey: "res_1" }]);

    expect(await requestReview(db as never, "res_1")).toBe(false);
    expect(notifyUser).not.toHaveBeenCalled();
  });

  it("no revienta un check-out si la notificación falla", async () => {
    notifyUser.mockRejectedValueOnce(new Error("Expo caído"));
    const db = fakePrisma([row()]);

    expect(await requestReview(db as never, "res_1")).toBe(false);
    // Sin sellar: el barrido de mantenimiento lo reintentará.
    expect(db.rows[0].reviewRequestedAt).toBeNull();
  });
});
