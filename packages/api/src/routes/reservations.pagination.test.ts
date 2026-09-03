import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { FastifyInstance } from "fastify";

// Lo que se protege aquí: que `GET /reservations` —la lectura que la app del
// admin dispara en CADA cambio de foco— pueda pedir de a poco, sin romper al
// binario ya instalado que sigue pidiendo todo el historial sin parámetros.

// `routes/services.ts` (importado en cadena) instancia Stripe al cargar el
// módulo y truena sin llave. Va en `vi.hoisted` porque los `import` de ESM se
// evalúan antes que cualquier sentencia del archivo.
vi.hoisted(() => {
  process.env.STRIPE_SECRET_KEY ||= "sk_test_falsa_para_tests";
});

let actor: { userId: string; userRole: string } = {
  userId: "u_admin",
  userRole: "ADMIN",
};

vi.mock("../middleware/auth", () => ({
  createAuthMiddleware: () => async (request: any) => {
    request.userId = actor.userId;
    request.userRole = actor.userRole;
  },
  createAdminMiddleware: () => async () => {},
  createStaffMiddleware: () => async () => {},
  invalidateAuthCache: () => {},
}));
// El barrido de mantenimiento pega a la base; aquí estorba.
vi.mock("../lib/maintenance", () => ({ triggerMaintenance: vi.fn() }));

import reservationsRoutes from "./reservations";

type Res = Record<string, any>;

// 5 reservas, de la más nueva a la más vieja. `r2` viene con la mascota rota
// (FK huérfana de datos legacy) para probar el filtro defensivo.
const TABLE: Res[] = Array.from({ length: 5 }, (_, i) => ({
  id: `r${i}`,
  ownerId: "u_jesus",
  petId: `p${i}`,
  totalAmount: 1000,
  internalNotes: `nota interna ${i}`,
  createdAt: new Date(2026, 0, 10 - i),
  pet: i === 2 ? null : { id: `p${i}`, name: `Perro ${i}` },
  owner: { id: "u_jesus", firstName: "Jesús" },
  room: null,
  staff: null,
  payments: [],
  changeRequests: [],
  updates: [],
  review: null,
  addons: [],
}));

let findMany: ReturnType<typeof vi.fn>;

function fakePrisma() {
  findMany = vi.fn(async (args: any) => {
    let rows = [...TABLE];
    if (args.cursor) {
      const at = rows.findIndex((r) => r.id === args.cursor.id);
      rows = at === -1 ? [] : rows.slice(at + (args.skip ?? 0));
    }
    return args.take ? rows.slice(0, args.take) : rows;
  });
  return {
    reservation: { findMany },
    petCoOwner: { findMany: vi.fn(async () => []) },
  } as any;
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorate("prisma", fakePrisma());
  await app.register(reservationsRoutes);
  await app.ready();
  return app;
}

let app: FastifyInstance;
beforeEach(async () => {
  actor = { userId: "u_admin", userRole: "ADMIN" };
  app = await buildApp();
});

describe("GET /reservations — la app ya instalada", () => {
  it("SIN parámetros sigue devolviendo el arreglo pelón, sin tope", async () => {
    const res = await app.inject({ method: "GET", url: "/reservations" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    // 5 filas menos la de FK huérfana.
    expect(body.map((r: Res) => r.id)).toEqual(["r0", "r1", "r3", "r4"]);
    expect(findMany.mock.calls[0][0].take).toBeUndefined();
    expect(findMany.mock.calls[0][0].cursor).toBeUndefined();
    expect(findMany.mock.calls[0][0].skip).toBeUndefined();
  });

  it("conserva los campos derivados de siempre", async () => {
    const body = (await app.inject({ method: "GET", url: "/reservations" })).json();
    expect(body[0]).toMatchObject({
      hasBalance: true,
      hasPendingChangeRequest: false,
      lastUpdateAt: null,
      hasReview: false,
      hasDeslanado: false,
      hasCorte: false,
    });
  });

  it("ordena por fecha con el id de desempate", async () => {
    await app.inject({ method: "GET", url: "/reservations" });
    expect(findMany.mock.calls[0][0].orderBy).toEqual([
      { createdAt: "desc" },
      { id: "desc" },
    ]);
  });
});

describe("GET /reservations — paginado", () => {
  it("con ?limit= devuelve { items, nextCursor, hasMore }", async () => {
    const res = await app.inject({ method: "GET", url: "/reservations?limit=2" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.map((r: Res) => r.id)).toEqual(["r0", "r1"]);
    expect(body.hasMore).toBe(true);
    expect(body.nextCursor).toBe("r1");
    expect(findMany.mock.calls[0][0].take).toBe(3);
  });

  it("el cursor sale de la fila LEÍDA, aunque se haya filtrado por rota", async () => {
    // limit=3 lee r0,r1,r2(+r3 de sobra). r2 se descarta por FK huérfana,
    // pero el cursor debe seguir siendo r2: si fuera r1, la página siguiente
    // volvería a traer r2 y el recorrido se atoraría.
    const body = (
      await app.inject({ method: "GET", url: "/reservations?limit=3" })
    ).json();
    expect(body.items.map((r: Res) => r.id)).toEqual(["r0", "r1"]);
    expect(body.nextCursor).toBe("r2");
    expect(body.hasMore).toBe(true);
  });

  it("recorre todo el historial con el cursor sin repetir ni perder", async () => {
    const seen: string[] = [];
    let url = "/reservations?limit=2";
    for (let guard = 0; guard < 10; guard++) {
      const body = (await app.inject({ method: "GET", url })).json();
      seen.push(...body.items.map((r: Res) => r.id));
      if (!body.hasMore) break;
      url = `/reservations?limit=2&cursor=${body.nextCursor}`;
    }
    expect(seen).toEqual(["r0", "r1", "r3", "r4"]);
  });

  it("pide el cursor con skip para no repetir la fila del cursor", async () => {
    await app.inject({ method: "GET", url: "/reservations?limit=2&cursor=r1" });
    expect(findMany.mock.calls[0][0]).toMatchObject({
      take: 3,
      cursor: { id: "r1" },
      skip: 1,
    });
  });

  it("la última página no trae cursor siguiente", async () => {
    const body = (
      await app.inject({ method: "GET", url: "/reservations?limit=50" })
    ).json();
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeNull();
  });

  it("limit inválido responde 400 en vez de devolver todo el historial", async () => {
    expect(
      (await app.inject({ method: "GET", url: "/reservations?limit=abc" })).statusCode
    ).toBe(400);
    expect(
      (await app.inject({ method: "GET", url: "/reservations?limit=-1" })).statusCode
    ).toBe(400);
  });
});

describe("GET /reservations — lo que NO debe cambiar al paginar", () => {
  it("el dueño no recibe la nota interna, tampoco dentro del envoltorio", async () => {
    actor = { userId: "u_jesus", userRole: "OWNER" };
    const body = (
      await app.inject({ method: "GET", url: "/reservations?limit=2" })
    ).json();
    expect(body.items[0].internalNotes).toBeUndefined();
  });

  it("el equipo sí la ve", async () => {
    const body = (
      await app.inject({ method: "GET", url: "/reservations?limit=2" })
    ).json();
    expect(body.items[0].internalNotes).toBe("nota interna 0");
  });

  it("al dueño se le sigue filtrando a lo suyo", async () => {
    actor = { userId: "u_jesus", userRole: "OWNER" };
    await app.inject({ method: "GET", url: "/reservations?limit=2&ownerId=u_otro" });
    expect(findMany.mock.calls[0][0].where).toMatchObject({ ownerId: "u_jesus" });
  });
});
