import { FastifyInstance } from "fastify";
import { createInternalGuard, logInternal } from "../lib/internalAuth";
import { abrirSolicitudClaim, detectarCuentasRepetidas } from "../lib/claimRequests";

// ─────────────────────────────────────────────────────────────────────────────
//  POST /internal/claim-requests/detect — barrido de cuentas repetidas
//
//  Clientes que tienen cuenta en la app Y una ficha sin vincular, por teléfono
//  o por nombre. Salió al revisar el caso de Andrea Castro (10-sep-2026): no
//  era la única. Corre dentro de Railway porque desde fuera no hay Postgres.
//
//    { apply: false }                      → solo la lista, no escribe nada
//    { apply: true, requesterIds: [...] }  → abre la solicitud de esas cuentas
//                                            (source ADMIN) y avisa a los admins
//
//  Nunca fusiona: abre solicitudes para que una persona las revise y apruebe
//  en la bandeja. `apply` solo acepta cuentas que el propio barrido encontró.
// ─────────────────────────────────────────────────────────────────────────────

export default async function internalClaimsRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const internalGuard = createInternalGuard(prisma);

  fastify.post<{ Body: { apply?: boolean; requesterIds?: string[] } }>(
    "/internal/claim-requests/detect",
    { preHandler: internalGuard },
    async (request, reply) => {
      const pares = await detectarCuentasRepetidas(prisma);
      if (request.body?.apply !== true) {
        return { apply: false, total: pares.length, pares };
      }

      const pedidas = [...new Set(request.body.requesterIds ?? [])];
      if (pedidas.length === 0) {
        return reply.status(400).send({ error: "Di qué cuentas (requesterIds)" });
      }
      const detectadas = new Set(pares.map((p) => p.cuentaApp.id));
      const resultado: { requesterId: string; id?: string; alreadyPending?: boolean; error?: string }[] = [];
      for (const requesterId of pedidas) {
        if (!detectadas.has(requesterId)) {
          resultado.push({ requesterId, error: "No salió en el barrido" });
          continue;
        }
        const cuenta = await prisma.user.findUnique({ where: { id: requesterId } });
        if (!cuenta) {
          resultado.push({ requesterId, error: "La cuenta ya no existe" });
          continue;
        }
        const abierta = await abrirSolicitudClaim(prisma, cuenta, {
          source: "ADMIN",
          typedPhone: cuenta.phone,
          note: "Detectada por el barrido de cuentas repetidas",
          actorId: request.internalActor?.userId ?? null,
        });
        resultado.push({ requesterId, ...abierta! });
      }
      logInternal(request, "claim-detect-apply", {
        abiertas: resultado.filter((r) => r.id && !r.alreadyPending).length,
      });
      return { apply: true, resultado };
    }
  );
}
