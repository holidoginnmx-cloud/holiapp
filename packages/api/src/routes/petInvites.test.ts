import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { FastifyInstance } from "fastify";

// Lo que se protege aquí: que el dueño pueda compartir a su perro SIN abrir la
// puerta de más. Una invitación sirve una sola vez, se puede cancelar, vence,
// respeta el tope de 3, y el código corto no se puede enumerar sin sesión.
// También que quitar a un co-dueño siga las reglas: el dueño quita a quien
// sea, el co-dueño solo se sale él.

// `routes/pets.ts` arrastra módulos que instancian Stripe al cargar.
vi.hoisted(() => {
  process.env.STRIPE_SECRET_KEY ||= "sk_test_falsa_para_tests";
});

type Actor = { userId: string; userRole: string; firstName: string; lastName: string };
let actor: Actor | null = null;

vi.mock("../middleware/auth", () => {
  const set = (request: any) => {
    request.userId = actor!.userId;
    request.userRole = actor!.userRole;
    request.dbUser = { firstName: actor!.firstName, lastName: actor!.lastName };
  };
  return {
    createAuthMiddleware: () => async (request: any, reply: any) => {
      if (!actor) return reply.status(401).send({ error: "No autorizado" });
      set(request);
    },
    createOptionalAuthMiddleware: () => async (request: any) => {
      if (actor) set(request);
    },
    createAdminMiddleware: () => async (request: any, reply: any) => {
      if (request.userRole !== "ADMIN") return reply.status(403).send({ error: "solo admin" });
    },
    createStaffMiddleware: () => async () => {},
    invalidateAuthCache: () => {},
  };
});

const notifyUser = vi.fn(async () => ({}));
vi.mock("../lib/notify", () => ({
  notifyUser: (...args: unknown[]) => notifyUser(...(args as [])),
  notifyUsers: vi.fn(async () => 0),
  notifyPetAudience: vi.fn(async () => 0),
}));
vi.mock("../lib/maintenance", () => ({ triggerMaintenance: vi.fn() }));

import { Prisma } from "@holidoginn/db";
import petInvitesRoutes from "./petInvites";
import petsRoutes from "./pets";
import { resetQuotas } from "../lib/quota";
import { newInviteToken, normalizeInviteKey } from "../lib/petInvite";

const jesus: Actor = { userId: "u_jesus", userRole: "OWNER", firstName: "Jesús", lastName: "Reynoso" };
const andrea: Actor = { userId: "u_andrea", userRole: "OWNER", firstName: "Andrea", lastName: "Martínez" };
const abuela: Actor = { userId: "u_abuela", userRole: "OWNER", firstName: "Lupita", lastName: "Borbón" };
const staff: Actor = { userId: "u_staff", userRole: "STAFF", firstName: "Staff", lastName: "HDI" };

// ─── Base en memoria ───────────────────────────────────────────────
type Invite = {
  id: string;
  petId: string;
  invitedById: string;
  token: string;
  code: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  acceptedById: string | null;
  revokedAt: Date | null;
  revokedById: string | null;
  createdAt: Date;
};
type State = {
  pets: { id: string; name: string; ownerId: string; isActive: boolean; photoUrl: string | null }[];
  coOwners: { petId: string; userId: string; createdById?: string | null }[];
  invites: Invite[];
};
let db: State;
let seq = 0;

const FIRST_NAMES: Record<string, { firstName: string; lastName: string }> = {
  u_jesus: jesus,
  u_andrea: andrea,
  u_abuela: abuela,
};

/** where con igualdades, `null` y `{ gt }` — lo que usan las rutas. */
function matches(row: Record<string, any>, where: Record<string, any> = {}) {
  return Object.entries(where).every(([k, v]) => {
    if (v === null) return row[k] === null;
    if (v && typeof v === "object" && "gt" in v) return row[k] > v.gt;
    return row[k] === v;
  });
}

function withInviteRelations(inv: Invite) {
  const pet = db.pets.find((p) => p.id === inv.petId)!;
  return { ...inv, pet, invitedBy: FIRST_NAMES[inv.invitedById] };
}

function fakePrisma(): any {
  const prisma: any = {
    // El candado FOR UPDATE: en memoria no hay concurrencia que serializar.
    $queryRaw: vi.fn(async () => []),
    pet: {
      findUnique: vi.fn(async ({ where }: any) => db.pets.find((p) => p.id === where.id) ?? null),
    },
    petCoOwner: {
      count: vi.fn(async ({ where }: any) => db.coOwners.filter((r) => matches(r, where)).length),
      create: vi.fn(async ({ data }: any) => {
        if (db.coOwners.some((r) => r.petId === data.petId && r.userId === data.userId)) {
          throw new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "t" });
        }
        db.coOwners.push(data);
        return data;
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        const before = db.coOwners.length;
        db.coOwners = db.coOwners.filter((r) => !matches(r, where));
        return { count: before - db.coOwners.length };
      }),
    },
    petInvite: {
      create: vi.fn(async ({ data }: any) => {
        const row: Invite = {
          id: `inv_${++seq}`,
          acceptedAt: null,
          acceptedById: null,
          revokedAt: null,
          revokedById: null,
          createdAt: new Date(),
          ...data,
        };
        db.invites.push(row);
        return row;
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        const row = db.invites.find((i) => matches(i, where));
        return row ? withInviteRelations(row) : null;
      }),
      findMany: vi.fn(async ({ where }: any) =>
        db.invites.filter((i) => matches(i, where)).map(withInviteRelations)
      ),
      count: vi.fn(async ({ where }: any) => db.invites.filter((i) => matches(i, where)).length),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const rows = db.invites.filter((i) => matches(i, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      }),
    },
  };
  // Transacción de verdad: si el callback truena, el estado vuelve a como estaba.
  prisma.$transaction = vi.fn(async (fn: (tx: any) => Promise<unknown>) => {
    const snapshot = structuredClone(db);
    try {
      return await fn(prisma);
    } catch (err) {
      db = snapshot;
      throw err;
    }
  });
  return prisma;
}

let app: FastifyInstance;

beforeEach(async () => {
  resetQuotas();
  notifyUser.mockClear();
  actor = null;
  db = {
    pets: [{ id: "p_nala", name: "Nala", ownerId: "u_jesus", isActive: true, photoUrl: null }],
    coOwners: [],
    invites: [],
  };
  app = Fastify();
  app.decorate("prisma", fakePrisma());
  await app.register(petInvitesRoutes);
  await app.register(petsRoutes);
  await app.ready();
});

async function as(who: Actor | null, method: "GET" | "POST" | "DELETE", url: string) {
  actor = who;
  const res = await app.inject({ method, url });
  return { status: res.statusCode, body: res.json() as any };
}

async function invite() {
  const res = await as(jesus, "POST", "/pets/p_nala/invites");
  expect(res.status).toBe(200);
  const row = db.invites[db.invites.length - 1];
  return { ...res.body, token: row.token, rawCode: row.code };
}

// ─── Crear ─────────────────────────────────────────────────────────
describe("POST /pets/:id/invites", () => {
  it("el dueño genera una liga con código legible y el mensaje ya escrito", async () => {
    const res = await invite();
    expect(res.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(res.url).toBe(`https://holidoginn.com.mx/invitacion/${res.token}`);
    expect(res.shareText).toContain(res.url);
    expect(res.shareText).toContain(res.code);
    expect(res.shareText).toContain("Nala");
  });

  it("el token de la liga sobrevive a la limpieza que se le hace al código tecleado", () => {
    // Regresión: con base64url los tokens traían guiones, la limpieza del
    // código ("ABCD-EFGH") los quitaba y la liga no se encontraba.
    for (let i = 0; i < 500; i++) {
      const t = newInviteToken();
      expect(normalizeInviteKey(t)).toBe(t);
      expect(t).toHaveLength(32);
    }
  });

  it("nadie más puede invitar: ni un co-dueño ni el equipo", async () => {
    db.coOwners.push({ petId: "p_nala", userId: "u_andrea" });
    expect((await as(andrea, "POST", "/pets/p_nala/invites")).status).toBe(403);
    expect((await as(staff, "POST", "/pets/p_nala/invites")).status).toBe(403);
  });

  it("cada invitación viva aparta un lugar del tope de 3", async () => {
    db.coOwners.push({ petId: "p_nala", userId: "u_andrea" });
    await invite();
    await invite();
    const res = await as(jesus, "POST", "/pets/p_nala/invites");
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("MAX_CO_OWNERS");
  });

  it("una invitación cancelada o vencida deja de apartar lugar", async () => {
    db.coOwners.push({ petId: "p_nala", userId: "u_andrea" });
    const a = await invite();
    await invite();
    db.invites.find((i) => i.id === a.id)!.expiresAt = new Date(Date.now() - 1000);
    expect((await as(jesus, "POST", "/pets/p_nala/invites")).status).toBe(200);
  });
});

// ─── Consultar ─────────────────────────────────────────────────────
describe("GET /invites/:key", () => {
  it("la página del sitio la abre por token sin sesión, y no devuelve el token", async () => {
    const inv = await invite();
    const res = await as(null, "GET", `/invites/${inv.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "valid",
      code: inv.code,
      pet: { name: "Nala" },
      invitedByFirstName: "Jesús",
      alreadyLinked: false,
      viewerIsOwner: false,
    });
    expect(JSON.stringify(res.body)).not.toContain(inv.token);
  });

  it("al dueño que abre su propia liga se le dice que es la suya", async () => {
    const inv = await invite();
    const res = await as(jesus, "GET", `/invites/${inv.token}`);
    expect(res.body).toMatchObject({ viewerIsOwner: true, alreadyLinked: true });
  });

  it("el código corto NO se puede buscar sin sesión (se enumeraría)", async () => {
    const inv = await invite();
    expect((await as(null, "GET", `/invites/${inv.rawCode}`)).status).toBe(401);
    expect((await as(andrea, "GET", `/invites/${inv.rawCode}`)).status).toBe(200);
  });

  it("frena a quien prueba códigos uno tras otro", async () => {
    let last = 0;
    for (let i = 0; i < 21; i++) {
      last = (await as(andrea, "GET", "/invites/AAAAAAAA")).status;
    }
    expect(last).toBe(429);
  });
});

// ─── Aceptar ───────────────────────────────────────────────────────
describe("POST /invites/:key/accept", () => {
  it("por la liga: queda de co-dueño y al dueño le llega el aviso", async () => {
    const inv = await invite();
    const res = await as(andrea, "POST", `/invites/${inv.token}/accept`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, petId: "p_nala", alreadyLinked: false });
    expect(db.coOwners).toEqual([{ petId: "p_nala", userId: "u_andrea", createdById: "u_jesus" }]);
    expect(db.invites[0].acceptedById).toBe("u_andrea");
    expect(notifyUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "u_jesus",
        data: { petId: "p_nala", kind: "PET_CO_OWNER_JOINED" },
      })
    );
  });

  it("por el código tecleado, en minúsculas y con guion", async () => {
    const inv = await invite();
    const typed = inv.code.toLowerCase(); // "abcd-efgh"
    const res = await as(andrea, "POST", `/invites/${typed}/accept`);
    expect(res.status).toBe(200);
    expect(db.coOwners).toHaveLength(1);
  });

  it("sirve una sola vez", async () => {
    const inv = await invite();
    await as(andrea, "POST", `/invites/${inv.token}/accept`);
    const res = await as(abuela, "POST", `/invites/${inv.token}/accept`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("INVITE_USED");
    expect(db.coOwners).toHaveLength(1);
  });

  it("no sirve cancelada ni vencida", async () => {
    const a = await invite();
    const b = await invite();
    expect((await as(jesus, "DELETE", `/pets/p_nala/invites/${a.id}`)).status).toBe(200);
    db.invites.find((i) => i.id === b.id)!.expiresAt = new Date(Date.now() - 1000);

    const revoked = await as(andrea, "POST", `/invites/${a.token}/accept`);
    expect(revoked.body.code).toBe("INVITE_REVOKED");
    const expired = await as(andrea, "POST", `/invites/${b.token}/accept`);
    expect(expired.body.code).toBe("INVITE_EXPIRED");
    expect(db.coOwners).toHaveLength(0);
  });

  it("el texto para la persona va en `error` y el código en `code` (lo que lee la app)", async () => {
    const inv = await invite();
    await as(andrea, "POST", `/invites/${inv.token}/accept`);
    const res = await as(abuela, "POST", `/invites/${inv.token}/accept`);
    expect(res.body.code).toBe("INVITE_USED");
    expect(res.body.error).toMatch(/ya se usó/);
  });

  it("el dueño abriendo su propia liga no se vuelve co-dueño de su perro", async () => {
    const inv = await invite();
    const res = await as(jesus, "POST", `/invites/${inv.token}/accept`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ALREADY_OWNER");
    expect(db.invites[0].acceptedAt).toBeNull();
  });

  it("si ya lo comparte, responde bien y NO gasta la invitación", async () => {
    db.coOwners.push({ petId: "p_nala", userId: "u_andrea" });
    const inv = await invite();
    const res = await as(andrea, "POST", `/invites/${inv.token}/accept`);
    expect(res.status).toBe(200);
    expect(res.body.alreadyLinked).toBe(true);
    expect(db.invites[0].acceptedAt).toBeNull();
  });

  it("una cuenta del equipo no puede aceptar", async () => {
    const inv = await invite();
    const res = await as(staff, "POST", `/invites/${inv.token}/accept`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("NOT_OWNER_ROLE");
  });

  it("si mientras tanto se llenó el tope, rebota y la invitación queda viva", async () => {
    const inv = await invite();
    // El equipo vinculó a tres personas a mano después de mandar la liga.
    db.coOwners.push(
      { petId: "p_nala", userId: "u_x1" },
      { petId: "p_nala", userId: "u_x2" },
      { petId: "p_nala", userId: "u_x3" }
    );
    const res = await as(andrea, "POST", `/invites/${inv.token}/accept`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("MAX_CO_OWNERS");
    // La transacción revirtió el sello: no se "gastó" en un intento fallido.
    expect(db.invites[0].acceptedAt).toBeNull();
  });
});

// ─── Cancelar ──────────────────────────────────────────────────────
describe("GET /pets/:id/invites", () => {
  it("el dueño recibe la liga para reenviarla; el equipo solo el código", async () => {
    await invite();
    const own = await as(jesus, "GET", "/pets/p_nala/invites");
    expect(own.body.invites[0].url).toContain("/invitacion/");
    expect(own.body.invites[0].shareText).toBeTruthy();

    const team = await as(staff, "GET", "/pets/p_nala/invites");
    expect(team.status).toBe(200);
    expect(team.body.invites[0].code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(team.body.invites[0].url).toBeUndefined();
    expect(JSON.stringify(team.body)).not.toContain(db.invites[0].token);
  });

  it("un co-dueño no ve las invitaciones", async () => {
    db.coOwners.push({ petId: "p_nala", userId: "u_andrea" });
    expect((await as(andrea, "GET", "/pets/p_nala/invites")).status).toBe(403);
  });
});

describe("DELETE /pets/:id/invites/:inviteId", () => {
  it("la cancela el dueño o el equipo, no el invitado", async () => {
    const a = await invite();
    const b = await invite();
    expect((await as(andrea, "DELETE", `/pets/p_nala/invites/${a.id}`)).status).toBe(403);
    expect((await as(staff, "DELETE", `/pets/p_nala/invites/${a.id}`)).status).toBe(200);
    expect((await as(jesus, "DELETE", `/pets/p_nala/invites/${b.id}`)).status).toBe(200);
  });

  it("una ya usada no se 'cancela' (eso no quitaría al co-dueño)", async () => {
    const inv = await invite();
    await as(andrea, "POST", `/invites/${inv.token}/accept`);
    const res = await as(jesus, "DELETE", `/pets/p_nala/invites/${inv.id}`);
    expect(res.status).toBe(404);
    expect(db.coOwners).toHaveLength(1);
  });
});

// ─── Quitar co-dueño ───────────────────────────────────────────────
describe("DELETE /pets/:id/co-owners/:userId", () => {
  beforeEach(() => {
    db.coOwners.push({ petId: "p_nala", userId: "u_andrea" }, { petId: "p_nala", userId: "u_abuela" });
  });

  it("el co-dueño se puede salir, y al dueño le avisan", async () => {
    const res = await as(andrea, "DELETE", "/pets/p_nala/co-owners/u_andrea");
    expect(res.status).toBe(200);
    expect(db.coOwners.map((r) => r.userId)).toEqual(["u_abuela"]);
    expect(notifyUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "u_jesus",
        data: { kind: "PET_CO_OWNER_LEFT", petId: "p_nala" },
      })
    );
  });

  it("un co-dueño no puede sacar a otro", async () => {
    const res = await as(andrea, "DELETE", "/pets/p_nala/co-owners/u_abuela");
    expect(res.status).toBe(403);
    expect(db.coOwners).toHaveLength(2);
  });

  it("el dueño quita a quien sea, y al quitado le avisan sin mandarlo a la ficha", async () => {
    const res = await as(jesus, "DELETE", "/pets/p_nala/co-owners/u_abuela");
    expect(res.status).toBe(200);
    expect(notifyUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: "u_abuela", data: { kind: "PET_UNSHARED" } })
    );
  });

  it("el staff no quita co-dueños (sigue siendo de admin)", async () => {
    expect((await as(staff, "DELETE", "/pets/p_nala/co-owners/u_abuela")).status).toBe(403);
  });
});
