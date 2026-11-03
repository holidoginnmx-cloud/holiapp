import { FastifyInstance } from "fastify";
import { createInternalGuard, logInternal } from "../lib/internalAuth";
import { purgeFinishedStayVideos } from "../lib/purgeEvidence";
import { sendPushToUser } from "../lib/push";
import { buildClientConfirmationMessage } from "../lib/notifyNewReservation";
import { stayDayBeforePush } from "../lib/clientReminders";
import type { PrismaClient } from "@holidoginn/db";
import {
  buildSoonMessage,
  buildTomorrowSummary,
  loadAgendaEvents,
  rangosDeManana,
  type AgendaEvent,
} from "../lib/teamAgenda";

/**
 * `sample: "AGENDA"`: el resumen de MAÑANA con los datos reales y un aviso de
 * 30 min de ejemplo (el primer evento con hora, o Molly si no hay ninguno).
 */
async function agendaTestMessages(prisma: PrismaClient): Promise<{ title: string; body: string }[]> {
  const now = new Date();
  const { dayRange, instantRange } = rangosDeManana(now);
  const events = await loadAgendaEvents(prisma, dayRange, instantRange);
  const resumen = buildTomorrowSummary(events) ?? {
    title: "📋 Mañana no hay llegadas, salidas ni baños",
    body: "(En la vida real este aviso no se manda cuando mañana no hay nada.)",
  };
  const conHora = events.find((e): e is AgendaEvent & { at: Date } => e.at !== null);
  const ejemplo =
    conHora ??
    ({
      tipo: "LLEGA",
      petNames: ["Molly"],
      at: new Date(now.getTime() + 30 * 60_000),
      domicilio: null,
      reservationId: "push-test",
      reservationType: "STAY",
      visitKey: "push-test",
    } as AgendaEvent & { at: Date });
  const pronto = buildSoonMessage(ejemplo, new Date(ejemplo.at.getTime() - 30 * 60_000));
  return [
    { title: `Prueba · ${resumen.title}`, body: resumen.body },
    { title: `Prueba · ${pronto.title}`, body: pronto.body },
  ];
}

/**
 * Qué mandar en la prueba. Por omisión, el aviso genérico. Con
 * `sample: "STAY"` manda los DOS push que recibe un cliente de hospedaje
 * (confirmación y un día antes), armados con las mismas funciones que los
 * reales y con «Polo» de ejemplo, para que el equipo vea cómo se ven.
 */
function pushTestMessages(sample: string | undefined): { title: string; body: string }[] {
  if (sample === "STAY") {
    // Fechas guardadas como el DÍA a las 00:00 UTC, igual que checkIn/checkOut.
    const hoy = new Date();
    const dia = (n: number) =>
      new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() + n));
    const confirmacion = buildClientConfirmationMessage({
      reservations: [
        { id: "push-test", reservationType: "STAY", checkIn: dia(7), checkOut: dia(10), pet: { name: "Polo" } },
      ],
    });
    return [
      { title: `Prueba · ${confirmacion.title}`, body: confirmacion.body },
      (({ title, body }) => ({ title: `Prueba · ${title}`, body }))(stayDayBeforePush("Polo", "10:00 am")),
    ];
  }
  return [
    {
      title: "🔔 Prueba de avisos",
      body: "Si ves esto, te llegan los avisos de reservas nuevas. No hay que hacer nada.",
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
//  POST /internal/purge-evidence — purga manual de videos de evidencia
//
//  La purga normal corre sola con el mantenimiento (cada 10 min) cuando
//  EVIDENCE_PURGE_ENABLED=true. Este endpoint es para las dos cosas que no
//  puede hacer sola:
//
//    · ver qué borraría ANTES de borrarlo  → { "dryRun": true }
//    · vaciar el histórico a ritmo controlado, en tandas
//
//  Corre DENTRO de Railway porque desde la máquina del usuario no hay Postgres
//  (ver memoria "no-hay-postgres-desde-la-maquina"). Se dispara con el
//  CRON_SECRET, igual que el resto de /internal/*.
//
//    { dryRun?: boolean, limit?: number, graceHours?: number }
//
//  `dryRun` es el valor POR OMISIÓN: para que borre de verdad hay que pedirlo
//  explícitamente con { "dryRun": false }. Es un borrado irreversible; la
//  equivocación debe ser no borrar, no borrar de más.
// ─────────────────────────────────────────────────────────────────────────────

export default async function internalMaintenanceRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const internalGuard = createInternalGuard(prisma);

  fastify.post<{
    Body: { dryRun?: boolean; limit?: number; graceHours?: number };
  }>(
    "/internal/purge-evidence",
    { preHandler: internalGuard },
    async (request, reply) => {
      const body = request.body ?? {};
      const dryRun = body.dryRun !== false;
      const limit =
        Number.isFinite(body.limit) && (body.limit as number) > 0
          ? Math.min(body.limit as number, 500)
          : undefined;

      const resumen = await purgeFinishedStayVideos(prisma, {
        dryRun,
        limit,
        graceHours: body.graceHours,
      });

      logInternal(request, "internal.purge-evidence", {
        dryRun,
        candidatos: resumen.candidatos,
        filasEliminadas: resumen.filasEliminadas,
        fallidos: resumen.fallidos,
        restantes: resumen.restantes,
      });

      if (!resumen.configured) {
        return reply.status(503).send({
          error:
            "Cloudinary sin llaves de administrador. Faltan CLOUDINARY_CLOUD_NAME, " +
            "CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET en Railway.",
          code: "CLOUDINARY_NOT_CONFIGURED",
          ...resumen,
        });
      }
      return resumen;
    }
  );

  // ───────────────────────────────────────────────────────────────────────────
  //  POST /internal/push-test — ¿a quién del equipo le llegan los avisos?
  //
  //  Manda un push de PRUEBA a los ADMIN activos (o a los roles que se pidan)
  //  y devuelve, por persona, cuántos teléfonos tiene registrados y si Expo
  //  aceptó el envío. Sirve para diagnosticar "a mí no me llegó el aviso de
  //  reserva nueva" sin tener que crear una reserva falsa.
  //
  //  Solo push: NO crea fila en la bandeja de notificaciones (sería ruido).
  //  Se dispara a mano desde GitHub Actions (cron.yml → job push-test).
  //
  //    { roles?: ("ADMIN" | "STAFF")[] }   — por omisión, solo ADMIN
  //    { sample?: "STAY" }                  — los push reales de hospedaje
  //    { sample?: "AGENDA" }                — resumen de mañana (datos reales) + aviso de 30 min
  // ───────────────────────────────────────────────────────────────────────────
  fastify.post<{ Body: { roles?: string[]; sample?: string } }>(
    "/internal/push-test",
    { preHandler: internalGuard },
    async (request, reply) => {
      const pedidos = (request.body?.roles ?? ["ADMIN"]).filter(
        (r): r is "ADMIN" | "STAFF" => r === "ADMIN" || r === "STAFF"
      );
      const roles = pedidos.length > 0 ? pedidos : (["ADMIN"] as const);
      const mensajes =
        request.body?.sample === "AGENDA"
          ? await agendaTestMessages(prisma)
          : pushTestMessages(request.body?.sample);

      const users = await prisma.user.findMany({
        where: { role: { in: [...roles] }, isActive: true },
        select: { id: true, firstName: true, lastName: true, role: true },
        orderBy: { firstName: "asc" },
      });

      const resultados = [];
      for (const u of users) {
        const tokens = await prisma.pushToken.findMany({
          where: { userId: u.id },
          select: { platform: true },
        });
        let aceptado = tokens.length > 0;
        for (const m of aceptado ? mensajes : []) {
          // kind PUSH_TEST: al tocarla no navega a una reserva que no existe.
          const ok = await sendPushToUser(prisma, u.id, { ...m, data: { kind: "PUSH_TEST" } });
          aceptado = aceptado && ok;
        }
        resultados.push({
          nombre: `${u.firstName ?? ""} ${u.lastName?.charAt(0) ?? ""}`.trim(),
          rol: u.role,
          telefonos: tokens.length,
          plataformas: tokens.map((t) => t.platform),
          aceptado,
        });
      }

      logInternal(request, "internal.push-test", {
        roles,
        sample: request.body?.sample ?? null,
        total: resultados.length,
        aceptados: resultados.filter((r) => r.aceptado).length,
      });

      return reply.send({
        total: resultados.length,
        aceptados: resultados.filter((r) => r.aceptado).length,
        resultados,
      });
    }
  );
}
