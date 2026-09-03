import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { FastifyInstance } from "fastify";

// El middleware real habla con Clerk. Aquí solo interesa quién pregunta.
let actor = { userId: "u_jesus", userRole: "OWNER" };
vi.mock("../middleware/auth", () => ({
  createAuthMiddleware: () => async (request: any) => {
    request.userId = actor.userId;
    request.userRole = actor.userRole;
  },
}));

import notificationsRoutes from "./notifications";

type Row = { id: string; userId: string; isRead: boolean; createdAt: Date };

const TABLE: Row[] = Array.from({ length: 7 }, (_, i) => ({
  id: `n${i}`,
  userId: "u_jesus",
  isRead: i % 2 === 0,
  // De la más nueva a la más vieja: n0 es la más reciente.
  createdAt: new Date(2026, 0, 10 - i),
}));

let findMany: ReturnType<typeof vi.fn>;

function fakePrisma() {
  findMany = vi.fn(async (args: any) => {
    let rows = TABLE.filter((r) => r.userId === args.where.userId);
    if (args.cursor) {
      const at = rows.findIndex((r) => r.id === args.cursor.id);
      rows = at === -1 ? [] : rows.slice(at + (args.skip ?? 0));
    }
    return args.take ? rows.slice(0, args.take) : rows;
  });
  return {
    prisma: {
      notification: {
        findMany,
        count: vi.fn(async ({ where }: any) =>
          TABLE.filter((r) => r.userId === where.userId && r.isRead === where.isRead).length
        ),
      },
      user: {
        findUnique: vi.fn(async ({ where }: any) =>
          where.id === "u_jesus" ? { id: "u_jesus" } : null
        ),
      },
    },
  };
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorate("prisma", fakePrisma().prisma as any);
  await app.register(notificationsRoutes);
  await app.ready();
  return app;
}

let app: FastifyInstance;
beforeEach(async () => {
  actor = { userId: "u_jesus", userRole: "OWNER" };
  app = await buildApp();
});

describe("GET /notifications/:userId — la app ya instalada", () => {
  it("SIN parámetros devuelve el arreglo pelón completo, como siempre", async () => {
    const res = await app.inject({ method: "GET", url: "/notifications/u_jesus" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(7);
    // Y sin tope ni cursor en la consulta: la lectura legacy no cambió.
    expect(findMany.mock.calls[0][0].take).toBeUndefined();
    expect(findMany.mock.calls[0][0].cursor).toBeUndefined();
  });

  it("ordena por fecha con el id de desempate", async () => {
    await app.inject({ method: "GET", url: "/notifications/u_jesus" });
    expect(findMany.mock.calls[0][0].orderBy).toEqual([
      { createdAt: "desc" },
      { id: "desc" },
    ]);
  });
});

describe("GET /notifications/:userId — paginado", () => {
  it("con ?limit= devuelve el envoltorio y pide una fila de más", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/notifications/u_jesus?limit=3",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.map((n: Row) => n.id)).toEqual(["n0", "n1", "n2"]);
    expect(body.hasMore).toBe(true);
    expect(body.nextCursor).toBe("n2");
    expect(findMany.mock.calls[0][0].take).toBe(4);
  });

  it("unreadCount es de la bandeja completa, no de la página", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/notifications/u_jesus?limit=1",
    });
    // 4 no leídas en toda la tabla (índices impares: n1,n3,n5 son isRead=false…)
    expect(res.json().unreadCount).toBe(TABLE.filter((r) => !r.isRead).length);
    expect(res.json().items).toHaveLength(1);
  });

  it("recorre toda la bandeja con el cursor sin repetir ni perder", async () => {
    const seen: string[] = [];
    let url = "/notifications/u_jesus?limit=3";
    for (let guard = 0; guard < 10; guard++) {
      const body = (await app.inject({ method: "GET", url })).json();
      seen.push(...body.items.map((n: Row) => n.id));
      if (!body.hasMore) break;
      url = `/notifications/u_jesus?limit=3&cursor=${body.nextCursor}`;
    }
    expect(seen).toEqual(TABLE.map((r) => r.id));
  });

  it("la última página no trae cursor siguiente", async () => {
    const body = (
      await app.inject({ method: "GET", url: "/notifications/u_jesus?limit=50" })
    ).json();
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeNull();
    expect(body.items).toHaveLength(7);
  });

  it("limit inválido responde 400 en vez de devolver todo", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/notifications/u_jesus?limit=0",
    });
    expect(res.statusCode).toBe(400);
  });

  it("cursor con basura responde 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/notifications/u_jesus?cursor=" + encodeURIComponent("x'; DROP--"),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /notifications/:userId — el guard sigue vivo", () => {
  it("otro dueño no lee la bandeja ajena ni paginando", async () => {
    actor = { userId: "u_otro", userRole: "OWNER" };
    const res = await app.inject({
      method: "GET",
      url: "/notifications/u_jesus?limit=3",
    });
    expect(res.statusCode).toBe(403);
  });

  it("usuario inexistente sigue dando 404", async () => {
    actor = { userId: "u_fantasma", userRole: "ADMIN" };
    const res = await app.inject({ method: "GET", url: "/notifications/u_fantasma" });
    expect(res.statusCode).toBe(404);
  });
});
