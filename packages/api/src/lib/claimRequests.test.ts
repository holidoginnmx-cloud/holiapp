import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./notify", () => ({
  adminsActivosIds: vi.fn(async () => ["u_admin"]),
  notifyUsers: vi.fn(async () => 1),
}));

import { notifyUsers } from "./notify";
import {
  abrirSolicitudClaim,
  detectarFichaPorTelefono,
  emparejarCuentas,
  mascotaEnFichaPendiente,
} from "./claimRequests";

type Previa = { id: string; status: "PENDING" | "REJECTED"; source?: "CLIENT" | "AUTO" | "ADMIN" } | null;

/** Prisma mockeado con lo que tocan estos helpers. */
function makePrisma({
  previa = null as Previa,
  pendiente = null as { typedPhone: string | null; typedEmail: string | null } | null,
  fichas = [] as string[],
  mascotas = [] as { id: string; name: string; ownerId: string }[],
} = {}) {
  return {
    $queryRaw: vi.fn(async () => fichas.map((id) => ({ id }))),
    user: { findMany: vi.fn(async () => []) },
    pet: {
      findMany: vi.fn(async ({ select }: { select: Record<string, boolean> }) =>
        select.ownerId && !select.name ? mascotas.map((m) => ({ ownerId: m.ownerId })) : mascotas,
      ),
    },
    claimRequest: {
      findFirst: vi.fn(async ({ select }: { select: Record<string, boolean> }) =>
        select.typedPhone ? pendiente : previa,
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "cr_nueva", ...data })),
      update: vi.fn(async () => ({})),
    },
  };
}

const ANDREA = {
  id: "u_app",
  firstName: "Andrea",
  lastName: "Castro",
  email: "andrea@example.com",
  phone: "+52 (662) 180 2448",
  role: "OWNER" as const,
  clerkId: "user_clerk",
  isActive: true,
};

beforeEach(() => vi.clearAllMocks());

describe("abrirSolicitudClaim", () => {
  it("devuelve la pendiente en vez de abrir otra", async () => {
    const prisma = makePrisma({ previa: { id: "cr_vieja", status: "PENDING" } });
    const r = await abrirSolicitudClaim(prisma as never, ANDREA, { source: "AUTO" });
    expect(r).toEqual({ id: "cr_vieja", alreadyPending: true });
    expect(prisma.claimRequest.create).not.toHaveBeenCalled();
  });

  it("si el cliente la pide y ya había una AUTO, se vuelve suya (con su nota)", async () => {
    const prisma = makePrisma({ previa: { id: "cr_auto", status: "PENDING", source: "AUTO" } });
    const r = await abrirSolicitudClaim(prisma as never, ANDREA, {
      source: "CLIENT",
      typedPhone: "662 180 2448",
      note: "Soy la dueña de Drago",
    });
    expect(r).toEqual({ id: "cr_auto", alreadyPending: true });
    expect(prisma.claimRequest.update).toHaveBeenCalledWith({
      where: { id: "cr_auto" },
      data: { source: "CLIENT", typedPhone: "662 180 2448", note: "Soy la dueña de Drago" },
    });
    expect(prisma.claimRequest.create).not.toHaveBeenCalled();
  });

  it("una AUTO nueva no toca la pendiente que ya pidió el cliente", async () => {
    const prisma = makePrisma({ previa: { id: "cr_cli", status: "PENDING", source: "CLIENT" } });
    await abrirSolicitudClaim(prisma as never, ANDREA, { source: "AUTO" });
    expect(prisma.claimRequest.update).not.toHaveBeenCalled();
  });

  it("con saltarSiRechazada no insiste si el equipo ya dijo que no", async () => {
    const prisma = makePrisma({ previa: { id: "cr_no", status: "REJECTED" } });
    const r = await abrirSolicitudClaim(prisma as never, ANDREA, { source: "AUTO", saltarSiRechazada: true });
    expect(r).toBeNull();
    expect(prisma.claimRequest.create).not.toHaveBeenCalled();
  });

  it("abre la AUTO con copia del solicitante y avisa a los admins con su propio texto", async () => {
    const prisma = makePrisma();
    const r = await abrirSolicitudClaim(prisma as never, ANDREA, {
      source: "AUTO",
      typedPhone: " +52 (662) 180 2448 ",
    });
    expect(r).toEqual({ id: "cr_nueva", alreadyPending: false });
    expect(prisma.claimRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requesterId: "u_app",
        requesterName: "Andrea Castro",
        requesterEmail: "andrea@example.com",
        typedPhone: "+52 (662) 180 2448",
        source: "AUTO",
      }),
    });
    expect(notifyUsers).toHaveBeenCalledWith(
      prisma,
      ["u_admin"],
      expect.objectContaining({
        title: "Posible cliente repetido",
        data: { kind: "CLAIM_REQUEST", claimRequestId: "cr_nueva" },
      }),
    );
  });

  it("sin aviso cuando la abre el propio equipo desde la bandeja", async () => {
    const prisma = makePrisma();
    await abrirSolicitudClaim(prisma as never, ANDREA, { source: "ADMIN", avisar: false });
    expect(notifyUsers).not.toHaveBeenCalled();
  });
});

describe("detectarFichaPorTelefono", () => {
  it("solo mira cuentas de clientes con app", async () => {
    const prisma = makePrisma({ fichas: ["u_ficha"], mascotas: [{ id: "p", name: "Drago", ownerId: "u_ficha" }] });
    expect(await detectarFichaPorTelefono(prisma as never, { ...ANDREA, role: "STAFF" })).toBeNull();
    expect(await detectarFichaPorTelefono(prisma as never, { ...ANDREA, clerkId: null })).toBeNull();
    expect(await detectarFichaPorTelefono(prisma as never, { ...ANDREA, phone: "662" })).toBeNull();
    expect(prisma.claimRequest.create).not.toHaveBeenCalled();
  });

  it("no abre nada si la ficha que coincide no tiene mascotas", async () => {
    const prisma = makePrisma({ fichas: ["u_ficha_vacia"], mascotas: [] });
    expect(await detectarFichaPorTelefono(prisma as never, ANDREA)).toBeNull();
    expect(prisma.claimRequest.create).not.toHaveBeenCalled();
  });

  it("abre la AUTO cuando el teléfono ya tiene ficha con mascotas", async () => {
    const prisma = makePrisma({
      fichas: ["u_ficha"],
      mascotas: [{ id: "p_drago", name: "Drago Castro", ownerId: "u_ficha" }],
    });
    const r = await detectarFichaPorTelefono(prisma as never, ANDREA);
    expect(r).toEqual({ id: "cr_nueva", alreadyPending: false });
    // Compara por los últimos 10 dígitos, no por el texto capturado.
    expect(prisma.$queryRaw).toHaveBeenCalledWith(expect.anything(), "6621802448");
    expect(prisma.claimRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ source: "AUTO", typedPhone: "+52 (662) 180 2448" }),
    });
  });
});

describe("mascotaEnFichaPendiente", () => {
  const FICHA = {
    pendiente: { typedPhone: "6621802448", typedEmail: null },
    fichas: ["u_ficha"],
    mascotas: [{ id: "p_drago", name: "Drago Castro", ownerId: "u_ficha" }],
  };

  it("sin solicitud pendiente no bloquea nada", async () => {
    const prisma = makePrisma({ ...FICHA, pendiente: null });
    expect(await mascotaEnFichaPendiente(prisma as never, ANDREA, "Drago")).toBeNull();
  });

  it("'Drago' es el 'Drago Castro' que capturó el equipo", async () => {
    const prisma = makePrisma(FICHA);
    expect(await mascotaEnFichaPendiente(prisma as never, ANDREA, " drago ")).toEqual(
      expect.objectContaining({ id: "p_drago", name: "Drago Castro" }),
    );
  });

  it("otro perro pasa", async () => {
    const prisma = makePrisma(FICHA);
    expect(await mascotaEnFichaPendiente(prisma as never, ANDREA, "Dragón Negro")).toBeNull();
  });

  it("'La Chula' no es 'La Güera', y un nombre de 2 letras no alcanza", async () => {
    const prisma = makePrisma({
      ...FICHA,
      mascotas: [
        { id: "p_guera", name: "La Güera", ownerId: "u_ficha" },
        { id: "p_bo", name: "Bo Castro", ownerId: "u_ficha" },
      ],
    });
    expect(await mascotaEnFichaPendiente(prisma as never, ANDREA, "La Chula")).toBeNull();
    expect(await mascotaEnFichaPendiente(prisma as never, ANDREA, "Bo")).toBeNull();
    expect(await mascotaEnFichaPendiente(prisma as never, ANDREA, "la güera")).toEqual(
      expect.objectContaining({ id: "p_guera" }),
    );
  });
});

describe("emparejarCuentas", () => {
  const p = (id: string, firstName: string, lastName: string | null, phone: string | null = null) => ({
    id,
    firstName,
    lastName,
    phone,
  });

  it("encuentra los casos reales del barrido y no los falsos", () => {
    const apps = [
      p("a_andrea", "Andrea", "Castro", "+52 (662) 180 2448"),
      p("a_jorge", "Jorge", "Hernández", "662 111 2233"),
      p("a_jesus", "jesus_andres98", ""),
      p("a_inda", "LUIS ENRRIQUE INDA", "—"),
      p("a_armenta", "JUAN JOSE ARMENTA", "—"),
    ];
    const fichas = [
      p("f_andrea", "Andrea", "Castro", "6621802448"),
      p("f_jorge", "JORGE ROBERTO HERNANDEZ LLAMAS", "—", "6629998877"),
      p("f_jesus", "JESUS ANDRES GRAJEDA OZUNA", "—"),
      p("f_olivarria", "LUIS ENRRIQUE OLIVARRIA", "—"),
      p("f_morales", "JOSE JUAN MORALES", "—"),
    ];
    expect(emparejarCuentas(apps, fichas)).toEqual([
      { appId: "a_andrea", fichaId: "f_andrea", por: "telefono" },
      { appId: "a_jorge", fichaId: "f_jorge", por: "nombre" },
      { appId: "a_jesus", fichaId: "f_jesus", por: "nombre" },
    ]);
  });
});
