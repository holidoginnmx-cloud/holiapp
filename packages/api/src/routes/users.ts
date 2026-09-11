import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { clerkClient } from "@clerk/fastify";
import { Prisma } from "@prisma/client";
import { CreateUserSchema, UpdateUserSchema } from "@holidoginn/shared";
import {
  createAuthMiddleware,
  createAdminMiddleware,
  createStaffMiddleware,
  invalidateAuthCache,
} from "../middleware/auth";
import { normalizePhone } from "../lib/phone";
import { takeQuota } from "../lib/quota";
import { pickSmsTarget } from "../lib/claimSms";
import { alternateChannel, planChannel } from "../lib/claimChannel";
import {
  claimPetsIntoAccount,
  ClaimUnavailableError,
  ClaimDiscardError,
  ClaimForbiddenError,
} from "../lib/userMerge";
import {
  createChallenge,
  createClaimToken,
  maskEmail,
  maskPhone,
  newCode,
  readClaimToken,
  verifyChallenge,
} from "../lib/claimChallenge";
import { claimCodeTemplate, emailConfigurado, sendEmail } from "../lib/email";
import { claimCodeSms, sendSms, smsConfigurado } from "../lib/sms";
import { adminsActivosIds, notifyUsers } from "../lib/notify";

// Correos de walk-in que crea el equipo (no son un buzón real).
const WALKIN_EMAIL_RE = /@holidoginn\.local$/i;
const CLAIM_CODE_MINUTES = 10;

const QUOTA_WINDOW_MS = 10 * 60 * 1000;

// Cuotas del envío por SMS. Van aparte de las de usuario porque el riesgo es
// otro: la cuota por usuario no impide que N cuentas de Clerk le peguen al
// MISMO número ajeno, y ahí cada intento cuesta dinero y además acosa a quien
// tenga esa línea. `sms:global` es el freno de gasto de todo el sistema.
const SMS_WINDOW_MS = 60 * 60 * 1000;
const SMS_PER_NUMBER = 3;
const SMS_GLOBAL_MAX = 40;

export default async function usersRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const authMiddleware = createAuthMiddleware(prisma);
  const adminMiddleware = createAdminMiddleware();
  const adminAuth = [authMiddleware, adminMiddleware];
  // El equipo de piso da de alta al cliente que llega sin cita. Es lo único
  // que se abre a STAFF aquí: listar, editar y desactivar clientes siguen
  // siendo de admin.
  const staffAuth = [authMiddleware, createStaffMiddleware()];

  // GET /users — listar (admin: todos; staff: solo clientes activos).
  // El staff la necesita para decir de quién es el perro que está capturando;
  // no para ver la plantilla ni las cuentas dadas de baja, así que el filtro
  // se aplica en la query, no en el cliente.
  fastify.get("/users", { preHandler: staffAuth }, async (request) => {
    const soloClientes = request.userRole !== "ADMIN";
    const users = await prisma.user.findMany({
      where: soloClientes ? { role: "OWNER", isActive: true } : undefined,
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { pushTokens: true } } },
    });
    // `hasApp` se computa en el servidor (no se confía en el cliente):
    // tiene cuenta vinculada (clerkId) o al menos un push token registrado
    // = el cliente descargó e inició sesión en la app.
    return users.map(({ _count, ...u }) => ({
      ...u,
      hasApp: !!u.clerkId || _count.pushTokens > 0,
    }));
  });

  // GET /users/me — obtener usuario autenticado por token de Clerk.
  // Lee SIEMPRE fresco de la DB (no la copia del caché de auth): este endpoint
  // sirve creditBalance/perfil, que cambian desde muchos flujos (reembolsos,
  // reservas con saldo, ajustes admin) y no vale la pena invalidar en todos.
  fastify.get(
    "/users/me",
    { preHandler: [createAuthMiddleware(prisma)] },
    async (request, reply) => {
      const fresh = await prisma.user.findUnique({
        where: { id: request.userId! },
      });
      return fresh ?? request.dbUser;
    }
  );

  // Fichas legacy (OWNER activo SIN app vinculada) que coinciden con el
  // teléfono (últimos 10 dígitos) o, como respaldo, con el correo exacto.
  async function findLegacyCandidates(
    phone: string | null,
    email: string | null,
    excludeId: string,
  ): Promise<string[]> {
    let ids: string[] = [];
    if (phone) {
      const rows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM users
        WHERE "clerkId" IS NULL AND "isActive" = true AND role = 'OWNER'
          AND right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = ${phone}
        LIMIT 10
      `;
      ids = rows.map((r) => r.id);
    }
    if (ids.length === 0 && email) {
      const byEmail = await prisma.user.findMany({
        where: { email, clerkId: null, isActive: true, role: "OWNER" },
        select: { id: true },
      });
      ids = byEmail.map((u) => u.id);
    }
    return ids.filter((id) => id !== excludeId);
  }

  // Lo que la pantalla necesita para que el cliente reconozca su ficha
  // (primer nombre + mascotas). Solo se entrega DESPUÉS de verificar el código.
  async function candidatesPayload(ids: string[]) {
    const users = await prisma.user.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        firstName: true,
        pets: {
          where: { isActive: true },
          select: { id: true, name: true, breed: true, photoUrl: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    return users.map((u) => ({
      candidateId: u.id,
      firstName: u.firstName,
      pets: u.pets,
    }));
  }

  // Vista previa de las mascotas SOLO para el callejón sin salida: la ficha
  // existe pero no hay a dónde mandar el código, así que el cliente no tiene
  // manera de comprobar que es suya desde la app y la vincula el equipo. Ver
  // los nombres es lo único que le confirma que la búsqueda dio con SU ficha
  // —y no con la de otro que tenga un teléfono parecido— antes de pedir la
  // vinculación manual. Es informativo: con esto no se reclama nada, y por eso
  // NUNCA acompaña a un envío de código (ahí la prueba es el código).
  async function petsPreview(ids: string[]) {
    return prisma.pet.findMany({
      where: { ownerId: { in: ids }, isActive: true },
      select: { id: true, name: true, breed: true, photoUrl: true },
      orderBy: { createdAt: "asc" },
      take: 8,
    });
  }

  // POST /users/claim/lookup — el cliente recién registrado busca su cuenta
  // preexistente (creada por el admin, aún sin app vinculada) por teléfono y,
  // como respaldo, por correo. Es el primer paso de la pantalla "¿Ya eres
  // cliente?".
  //
  // Antes devolvía nombre y mascotas de cualquier teléfono, y con eso bastaba
  // para reclamar la ficha. Ahora solo dice si hay coincidencia y manda un
  // código de 6 dígitos al contacto que YA tiene la ficha (nunca al que
  // escriba quien busca: ahí está toda la prueba de identidad); nombre y
  // mascotas se entregan en /verify, con el código.
  //
  // El canal es SMS y, si no hay teléfono utilizable o el envío falla, correo.
  // Ese orden sale de los datos: el 85% de las fichas de clientes sin app
  // tiene teléfono capturado y solo el 16% un correo real. Si no hay ningún
  // canal, se devuelve el respaldo de WhatsApp —con las mascotas de la ficha,
  // ya solo informativas: ver `petsPreview`— para que el equipo la vincule.
  fastify.post<{ Body: { phone?: string; email?: string; v?: number; prefer?: "email" | "sms" } }>(
    "/users/claim/lookup",
    {
      preHandler: [authMiddleware],
      // Cuota por IP laxa (CG-NAT); la cuota real es por usuario, abajo.
      config: { rateLimit: { max: 40, timeWindow: "10 minutes" } },
    },
    async (request, reply) => {
      const currentUserId = request.userId!;
      const phone = normalizePhone(request.body?.phone);
      const email = request.body?.email?.trim().toLowerCase() || null;
      if (!phone && !email) {
        return reply
          .status(400)
          .send({ error: "Ingresa tu teléfono o tu correo" });
      }
      if (!takeQuota(`lookup:${currentUserId}`, 5, QUOTA_WINDOW_MS)) {
        return reply.status(429).send({
          error: "Demasiados intentos. Espera 10 minutos o escríbenos por WhatsApp.",
        });
      }

      const candidateIds = await findLegacyCandidates(phone, email, currentUserId);
      if (candidateIds.length === 0) {
        return reply.send({ found: false, channel: "none", candidates: [] });
      }

      // Versión del cliente. `v` dice qué sabe entender la app que pregunta:
      //   <2  ni siquiera sabe pedir un código (leería `candidates: []` como
      //       "no encontramos" mientras al cliente le llega un correo).
      //   =2  entiende el código por CORREO, nada más.
      //   >=3 entiende también el código por SMS.
      const v = Number(request.body?.v) || 0;

      if (v < 2) {
        return reply.send({
          found: true,
          channel: "none",
          candidates: [],
          message:
            "Encontramos tu ficha. Actualiza la app a la última versión para vincularla con un código que te llegará por correo.",
        });
      }

      const owners = await prisma.user.findMany({
        where: { id: { in: candidateIds } },
        select: { email: true, firstName: true, phone: true },
      });
      const realEmails = Array.from(
        new Set(
          owners
            .map((o) => o.email?.trim().toLowerCase() ?? "")
            .filter((e) => e && !WALKIN_EMAIL_RE.test(e)),
        ),
      ).slice(0, 3);

      // ─────────────────────────────────────────────────────────────────
      //  A dónde va el código
      //
      //  SMS primero y correo después, no al revés: de las fichas de clientes
      //  sin app, el 85% tiene teléfono capturado y solo el 16% un correo de
      //  verdad (el resto son `@holidoginn.local`, que genera el sistema al
      //  dar de alta un walk-in). El correo se conserva porque hay clientes
      //  que solo tienen eso.
      // ─────────────────────────────────────────────────────────────────
      const respaldoWhatsapp = async (message?: string) => ({
        found: true,
        channel: "none" as const,
        candidates: [],
        // Lo único que ve el cliente de la ficha cuando no hay código posible.
        pets: await petsPreview(candidateIds),
        message:
          message ??
          "Encontramos tu ficha, pero no pudimos enviarte el código. Escríbenos por WhatsApp y te la vinculamos.",
      });

      // La app en tienda (v:2) espera `channel:"email"`: si le devolviéramos
      // "sms" pagaríamos el mensaje y ella igual mostraría "no tiene correo".
      // Con v:2 se conserva exactamente el comportamiento de antes.
      // `smsConfigurado()` y no solo la versión: sin proveedor, ofrecer el SMS
      // como canal alterno mandaría al cliente a pulsar un botón que le
      // devuelve otro correo. Sin él, el comportamiento es exactamente el de
      // antes de esta entrega, y encenderlo es poner las variables.
      const puedeSms = v >= 3 && smsConfigurado();
      const smsTarget = puedeSms ? pickSmsTarget(owners, phone) : ({ ok: false, reason: "no-phone" } as const);
      // `sendEmail` traga sus errores y devuelve void, así que sin esta
      // comprobación marcaríamos el correo como enviado cuando ni siquiera hay
      // proveedor configurado — y el cliente esperaría un código inexistente.
      const hayCorreo = realEmails.length > 0 && emailConfigurado();
      const plan = planChannel(smsTarget.ok, hayCorreo, request.body?.prefer);

      if (plan.first === "none") {
        if (!hayCorreo && !puedeSms) {
          // Ficha sin correo y app vieja: el mensaje de siempre. NO se le pide
          // actualizar porque el build de la tienda no recibe este OTA — sería
          // mandarlo a un callejón peor.
          return reply.send(
            await respaldoWhatsapp(
              "Encontramos tu ficha, pero no tiene un correo para enviarte el código. Escríbenos por WhatsApp y te la vinculamos.",
            ),
          );
        }
        request.log.info(
          { tag: "claim-sms-skipped", reason: smsTarget.ok ? "sin-canal" : smsTarget.reason, userId: currentUserId },
          "[claim] sin canal para el código",
        );
        return reply.send(await respaldoWhatsapp());
      }

      const code = newCode();
      const challengeToken = createChallenge(currentUserId, candidateIds, code);
      const firstName = owners.find((o) => o.firstName)?.firstName ?? null;

      let usado: "sms" | "email" | null = null;
      // Por qué no salió el SMS, si es que se intentó (para no volver a ofrecerlo).
      let smsFallo: string | null = null;

      if (plan.first === "sms" && smsTarget.ok) {
        // Cuota POR NÚMERO DESTINO, no solo por usuario: si no, N cuentas
        // pueden bombardear el mismo teléfono ajeno a costa del negocio.
        const conCupo =
          takeQuota(`sms:num:${smsTarget.e164}`, SMS_PER_NUMBER, SMS_WINDOW_MS) &&
          takeQuota("sms:global", SMS_GLOBAL_MAX, SMS_WINDOW_MS);

        if (!conCupo) {
          // Sin cupo no se corta el flujo: se sigue a la cascada como si el
          // SMS no estuviera disponible. Devolver aquí dejaba sin código a
          // quien sí tiene correo, y además borraba en la pantalla un reto que
          // seguía siendo válido con el código que ya había recibido.
          request.log.warn(
            { tag: "claim-sms-throttled", userId: currentUserId },
            "[claim] cuota de SMS agotada",
          );
          smsFallo = "throttled";
        } else {
          const enviado = await sendSms({
            to: smsTarget.e164,
            body: claimCodeSms({ code, minutes: CLAIM_CODE_MINUTES }),
          });
          if (enviado.ok) {
            usado = "sms";
          } else {
            smsFallo = enviado.reason;
            request.log.error(
              { tag: "claim-sms-failed", reason: enviado.reason, detail: enviado.detail, userId: currentUserId },
              "[claim] SMS no enviado",
            );
          }
        }
      }

      // Correo: como plan principal, o como red cuando el SMS no salió.
      if (!usado && hayCorreo) {
        const tpl = claimCodeTemplate({ firstName, code, minutes: CLAIM_CODE_MINUTES });
        await Promise.all(realEmails.map((to) => sendEmail({ to, ...tpl })));
        usado = "email";
      }

      if (!usado) {
        // Nunca se le dice "te mandamos un código" si no salió ninguno: se
        // quedaría esperando uno que no existe. El token no se devuelve.
        return reply.send(
          await respaldoWhatsapp(
            smsFallo === "throttled"
              ? "Ya te mandamos un código hace poco. Revisa tus mensajes, o escríbenos por WhatsApp."
              : undefined,
          ),
        );
      }

      request.log.info(
        { tag: "claim-code-sent", channel: usado, userId: currentUserId, candidates: candidateIds.length },
        "[claim] código enviado",
      );

      return reply.send({
        found: true,
        channel: usado,
        candidates: [],
        ...(usado === "sms" && smsTarget.ok
          ? { maskedPhones: [maskPhone(smsTarget.e164)] }
          : { maskedEmails: realEmails.map(maskEmail) }),
        // Si se usó el correo PORQUE el SMS falló, ofrecer SMS mandaría al
        // cliente a repetir el canal roto y a gastar otro crédito del número.
        altChannel: alternateChannel(usado, smsTarget.ok && !smsFallo, hayCorreo),
        challengeToken,
        expiresInMinutes: CLAIM_CODE_MINUTES,
      });
    }
  );

  // ────────────────────────────────────────────────────────────
  //  Bandeja del equipo para las solicitudes de vinculación
  //
  //  Solo ADMIN: vincular una ficha da acceso a su historial, sus reservas y
  //  su saldo a favor. Mismo criterio que los co-dueños de una mascota, que
  //  también son solo-admin, y coherente con "el staff crea, pero no toca
  //  dinero".
  // ────────────────────────────────────────────────────────────
  fastify.get<{ Querystring: { status?: string } }>(
    "/admin/claim-requests",
    { preHandler: adminAuth },
    async (request) => {
      const status =
        request.query?.status === "all"
          ? undefined
          : ((request.query?.status?.toUpperCase() as "PENDING" | "APPROVED" | "REJECTED") ??
            "PENDING");

      const rows = await prisma.claimRequest.findMany({
        where: status ? { status } : undefined,
        orderBy: { createdAt: "desc" },
        take: 100,
        include: {
          requester: {
            select: { id: true, firstName: true, lastName: true, email: true, phone: true },
          },
          resolvedBy: { select: { firstName: true, lastName: true } },
        },
      });

      // Los candidatos se recalculan AHORA y no se leen de la solicitud: el
      // equipo tiene que decidir sobre lo que es verdad hoy, no sobre una foto
      // de cuando el cliente la mandó (pudieron corregirle el teléfono, o
      // fusionar fichas, desde entonces).
      return Promise.all(
        rows.map(async (r) => {
          // Sin requesterId la cuenta ya no existe (se consolidó), así que
          // no hay a quién vincular ni candidatos que calcular.
          if (r.status !== "PENDING" || !r.requesterId) {
            return { ...r, candidates: [], requesterPets: [] };
          }
          const ids = await findLegacyCandidates(
            normalizePhone(r.typedPhone),
            r.typedEmail,
            r.requesterId,
          );
          // Lo que YA registró en su cuenta nueva. El ADMIN necesita verlo:
          // casi siempre es el mismo perro que está en la ficha, y sin esto
          // vincularía a ciegas y le dejaría el perro duplicado. `reservas`
          // dice si se puede descartar (con historial propio, no).
          const suyas = await prisma.pet.findMany({
            where: { ownerId: r.requesterId, isActive: true },
            select: {
              id: true,
              name: true,
              breed: true,
              photoUrl: true,
              _count: { select: { reservations: true } },
            },
            orderBy: { createdAt: "asc" },
          });
          return {
            ...r,
            candidates: await candidatesPayload(ids),
            requesterPets: suyas.map(({ _count, ...p }) => ({
              ...p,
              reservas: _count.reservations,
            })),
          };
        }),
      );
    }
  );

  // GET /admin/claim-requests/search?q= — buscar la ficha a mano.
  //
  // Hace falta porque la coincidencia automática falla justo en el caso que
  // trae al cliente aquí: si su ficha tiene el teléfono mal escrito, no la
  // encuentra ni él ni el sistema. El equipo la busca por nombre.
  fastify.get<{ Querystring: { q?: string } }>(
    "/admin/claim-requests/search",
    { preHandler: adminAuth },
    async (request, reply) => {
      const q = request.query?.q?.trim();
      if (!q || q.length < 2) {
        return reply.status(400).send({ error: "Escribe al menos 2 letras" });
      }
      const digits = q.replace(/\D/g, "");
      // Solo fichas sin cuenta vinculada: las demás no se pueden consolidar.
      const fichas = await prisma.user.findMany({
        where: {
          clerkId: null,
          isActive: true,
          role: "OWNER",
          OR: [
            { firstName: { contains: q, mode: "insensitive" } },
            { lastName: { contains: q, mode: "insensitive" } },
            ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : []),
          ],
        },
        select: { id: true },
        take: 15,
      });
      return candidatesPayload(fichas.map((f) => f.id));
    }
  );

  // POST /admin/claim-requests/:id/approve — el equipo da fe de que la ficha
  // es suya. Reusa exactamente el mismo merge que el flujo con código
  // (claimPetsIntoAccount): lo que cambia es quién autoriza, no qué se hace.
  fastify.post<{
    Params: { id: string };
    Body: { petIds?: string[]; discardPetIds?: string[] };
  }>(
    "/admin/claim-requests/:id/approve",
    { preHandler: adminAuth },
    async (request, reply) => {
      const solicitud = await prisma.claimRequest.findUnique({
        where: { id: request.params.id },
      });
      if (!solicitud) return reply.status(404).send({ error: "Solicitud no encontrada" });
      if (solicitud.status !== "PENDING") {
        return reply.status(409).send({ error: "Esa solicitud ya se resolvió" });
      }

      const fresh = solicitud.requesterId
        ? await prisma.user.findUnique({ where: { id: solicitud.requesterId } })
        : null;
      if (!fresh) {
        return reply
          .status(409)
          .send({ error: "La cuenta que pidió ya no existe (puede que ya se haya vinculado)." });
      }

      const petIds = [
        ...new Set((request.body?.petIds ?? []).filter((x) => typeof x === "string" && x)),
      ];
      if (petIds.length === 0) {
        return reply.status(400).send({ error: "Selecciona al menos una mascota" });
      }

      // Autorización: las fichas dueñas de las mascotas que el ADMIN eligió.
      //
      // A propósito NO se limita a las fichas que coinciden por teléfono o
      // correo: el caso más común de esta pantalla es precisamente que la
      // coincidencia automática NO funciona (la ficha tiene el teléfono mal
      // capturado, o de menos de 10 dígitos, y por eso el cliente no pudo
      // verificarse solo). Si aquí exigiéramos coincidencia, la herramienta
      // fallaría justo cuando se la necesita.
      //
      // Quien da fe es el equipo, que conoce a sus clientes por nombre. Lo que
      // sí se sigue validando —dentro de claimPetsIntoAccount, en la misma
      // transacción— es que las fichas sean OWNER, activas y SIN cuenta ya
      // vinculada, así que no se le puede quitar la ficha a nadie que ya use
      // la app. Y queda registrado quién aprobó.
      const duenos = await prisma.pet.findMany({
        where: { id: { in: petIds }, isActive: true },
        select: { ownerId: true },
      });
      const allowedIds = [...new Set(duenos.map((d) => d.ownerId))];
      if (allowedIds.length === 0) {
        return reply.status(409).send({ error: "Esas mascotas ya no existen." });
      }

      try {
        // Mascotas que la propia cuenta nueva registró y que el ADMIN marcó
        // como repetidas de las de la ficha. Se desactivan en el mismo merge
        // para no dejar al cliente con el mismo perro dos veces.
        const discardPetIds = [
          ...new Set(
            (request.body?.discardPetIds ?? []).filter((x) => typeof x === "string" && x),
          ),
        ];
        const merged = await claimPetsIntoAccount(
          prisma,
          fresh,
          petIds,
          allowedIds,
          solicitud.typedPhone,
          discardPetIds,
        );
        // OJO con el orden y con los ids: `claimPetsIntoAccount` BORRA la
        // cuenta nueva y deja el historial bajo la ficha vieja, que hereda su
        // clerkId. Así que `fresh.id` ya no existe aquí — hay que usar el
        // usuario consolidado que devuelve el merge. El clerkId sí es el mismo.
        await prisma.claimRequest.update({
          where: { id: solicitud.id },
          data: {
            status: "APPROVED",
            resolvedById: request.userId!,
            resolvedAt: new Date(),
            mergedIntoId: merged.id,
          },
        });
        invalidateAuthCache(fresh.clerkId);
        await notifyUsers(prisma, [merged.id], {
          type: "GENERAL",
          title: "¡Tu cuenta ya está vinculada!",
          body: "Ya puedes ver a tus mascotas y su historial en la app.",
          data: { kind: "CLAIM_APPROVED" },
        });
        request.log.info(
          { tag: "claim-request-approved", id: solicitud.id, by: request.userId },
          "[claim] vinculación aprobada por el equipo",
        );
        return reply.send(merged);
      } catch (err) {
        if (err instanceof ClaimForbiddenError) {
          return reply.status(403).send({ error: "Esas mascotas no corresponden a la ficha." });
        }
        if (err instanceof ClaimUnavailableError) {
          return reply
            .status(409)
            .send({ error: "La ficha cambió mientras se vinculaba. Vuelve a intentar." });
        }
        if (err instanceof ClaimDiscardError) {
          return reply.status(409).send({
            error:
              "Esa mascota ya tiene reservas a su nombre, así que no se puede descartar. Vincula sin descartarla y júntalas después.",
          });
        }
        throw err;
      }
    }
  );

  // POST /admin/claim-requests/:id/reject — no era su ficha, o no se pudo
  // confirmar quién es. No se le manda push: si el equipo la rechaza es porque
  // ya habló con esa persona, o porque el intento era ajeno. Sí lo verá la
  // próxima vez que abra sus mascotas (`/users/claim/request/mine`), para que
  // no se quede esperando indefinidamente algo que ya se resolvió — pero solo
  // el hecho, nunca `resolution`, que es la nota interna del equipo.
  fastify.post<{ Params: { id: string }; Body: { reason?: string } }>(
    "/admin/claim-requests/:id/reject",
    { preHandler: adminAuth },
    async (request, reply) => {
      const solicitud = await prisma.claimRequest.findUnique({
        where: { id: request.params.id },
      });
      if (!solicitud) return reply.status(404).send({ error: "Solicitud no encontrada" });
      if (solicitud.status !== "PENDING") {
        return reply.status(409).send({ error: "Esa solicitud ya se resolvió" });
      }
      return reply.send(
        await prisma.claimRequest.update({
          where: { id: solicitud.id },
          data: {
            status: "REJECTED",
            resolvedById: request.userId!,
            resolvedAt: new Date(),
            resolution: request.body?.reason?.trim().slice(0, 300) || null,
          },
        }),
      );
    }
  );
  // ────────────────────────────────────────────────────────────
  //  GET /users/claim/request/mine — en qué va MI solicitud
  //
  //  Sin esto el cliente pedía la vinculación y se quedaba a ciegas: la
  //  pantalla "¿Ya eres cliente?" se muestra UNA sola vez por cuenta (marca en
  //  SecureStore), así que ni siquiera podía volver a ver su "Solicitud
  //  enviada ✓". Si el equipo tardaba dos días, para él era indistinguible de
  //  que nadie la hubiera recibido. Con esto la app puede decirle en qué va
  //  desde donde sí va a estar: su lista de mascotas.
  // ────────────────────────────────────────────────────────────
  fastify.get("/users/claim/request/mine", { preHandler: [authMiddleware] }, async (request) => {
    const ultima = await prisma.claimRequest.findFirst({
      where: { requesterId: request.userId! },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        createdAt: true,
        resolvedAt: true,
        // `resolution` NO se expone: nació como nota INTERNA del rechazo ("no
        // contestó", "sospechoso") y el equipo la escribe sabiendo que es
        // suya. Mandársela al cliente cambiaría su audiencia sin avisarles.
      },
    });
    // Una aprobada no se devuelve: al consolidarse la cuenta se BORRA, así que
    // quien pregunta con esa sesión ya está viendo sus mascotas. Si apareciera,
    // sería un aviso de algo que ya ocurrió.
    if (!ultima || ultima.status === "APPROVED") return { request: null };
    return { request: ultima };
  });

  // ────────────────────────────────────────────────────────────
  //  POST /users/claim/request — "vincúlenme ustedes"
  //
  //  La salida para el cliente al que no se le puede mandar un código porque
  //  su ficha no tiene ningún contacto utilizable. Antes esto era un callejón
  //  ("escríbenos por WhatsApp") y alguien del equipo lo resolvía a mano sin
  //  herramienta; ahora queda registrado y les llega a su bandeja.
  // ────────────────────────────────────────────────────────────
  fastify.post<{ Body: { phone?: string; email?: string; note?: string } }>(
    "/users/claim/request",
    {
      preHandler: [authMiddleware],
      config: { rateLimit: { max: 10, timeWindow: "10 minutes" } },
    },
    async (request, reply) => {
      const currentUserId = request.userId!;
      if (!takeQuota(`claim-request:${currentUserId}`, 3, QUOTA_WINDOW_MS)) {
        return reply.status(429).send({
          error: "Ya mandaste tu solicitud. El equipo la revisará en breve.",
        });
      }

      // Una pendiente a la vez: si insiste, se le confirma la que ya tiene en
      // vez de llenarle la bandeja al equipo con la misma persona repetida.
      const yaPendiente = await prisma.claimRequest.findFirst({
        where: { requesterId: currentUserId, status: "PENDING" },
      });
      if (yaPendiente) {
        return reply.send({ ok: true, alreadyPending: true, id: yaPendiente.id });
      }

      const quien = request.dbUser;
      const nombre = [quien?.firstName, quien?.lastName].filter(Boolean).join(" ").trim();

      const solicitud = await prisma.claimRequest.create({
        data: {
          requesterId: currentUserId,
          // Copia del solicitante: su cuenta desaparece al consolidarse (el
          // merge la borra y la ficha vieja hereda su identidad), así que sin
          // esto el historial quedaría sin nombre.
          requesterName: nombre || null,
          requesterEmail: quien?.email ?? null,
          typedPhone: request.body?.phone?.trim() || null,
          typedEmail: request.body?.email?.trim().toLowerCase() || null,
          note: request.body?.note?.trim().slice(0, 300) || null,
        },
      });

      const contacto = solicitud.typedPhone ?? solicitud.typedEmail ?? "sin dato";
      // Solo ADMIN: son los únicos que pueden aprobarla (`adminAuth`).
      const equipo = await adminsActivosIds(prisma, currentUserId);
      await notifyUsers(prisma, equipo, {
        type: "GENERAL",
        title: "Alguien pide vincular su ficha",
        body: `${nombre || "Un cliente"} (${contacto}) instaló la app y no pudimos mandarle un código. Revisa su solicitud.`,
        data: { kind: "CLAIM_REQUEST", claimRequestId: solicitud.id },
      });

      request.log.info(
        { tag: "claim-request-created", userId: currentUserId, id: solicitud.id },
        "[claim] solicitud de vinculación manual",
      );
      return reply.send({ ok: true, alreadyPending: false, id: solicitud.id });
    }
  );

  // POST /users/claim/verify — el cliente escribe el código que le llegó.
  // Devuelve las fichas (nombre + mascotas) y un token de claim que /confirm
  // exige. Cuota corta por IP: 10^6 códigos con 10 minutos de vida.
  fastify.post<{ Body: { challengeToken?: string; code?: string } }>(
    "/users/claim/verify",
    {
      preHandler: [authMiddleware],
      config: { rateLimit: { max: 40, timeWindow: "10 minutes" } },
    },
    async (request, reply) => {
      const currentUserId = request.userId!;
      const token = request.body?.challengeToken;
      const code = request.body?.code?.replace(/\D/g, "") ?? "";
      if (!token || code.length !== 6) {
        return reply.status(400).send({ error: "Escribe el código de 6 dígitos" });
      }
      if (!takeQuota(`verify:${currentUserId}`, 8, QUOTA_WINDOW_MS)) {
        return reply.status(429).send({
          error: "Demasiados intentos con el código. Espera 10 minutos y vuelve a buscar tu cuenta.",
        });
      }
      const result = verifyChallenge(token, currentUserId, code);
      if (!result.ok) {
        const message =
          result.reason === "expired"
            ? "El código venció. Vuelve a buscar tu cuenta para recibir otro."
            : result.reason === "wrong-code"
              ? "El código no coincide. Revísalo e inténtalo de nuevo."
              : "No pudimos validar el código. Vuelve a buscar tu cuenta.";
        return reply.status(400).send({ error: message, code: result.reason });
      }
      const candidates = await candidatesPayload(result.ids);
      return reply.send({
        candidates,
        claimToken: createClaimToken(currentUserId, result.ids),
      });
    }
  );

  // POST /users/claim/confirm — el cliente confirma cuáles mascotas son suyas.
  // Consolida su cuenta nueva (Clerk) con esas mascotas bajo un solo registro,
  // reuniendo las que estaban repartidas en registros legacy duplicados.
  // Ver lib/userMerge.ts (claimPetsIntoAccount).
  fastify.post<{
    Body: {
      petIds?: string[];
      /** Token de /users/claim/verify (obligatorio). */
      claimToken?: string;
      // `candidateId`/`email` de apps previas ya no autorizan nada; `phone`
      // solo se usa para completar la ficha si no tenía teléfono.
      candidateId?: string;
      phone?: string;
      email?: string;
    };
  }>(
    "/users/claim/confirm",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const fresh = request.dbUser!;

      // Antes aquí se exigía que la cuenta fuera nueva (sin mascotas ni
      // reservas) y si no, 409: "escríbenos para vincularla". Pero ese es el
      // camino más natural del cliente —no encuentra su ficha, registra a su
      // perro, y luego se vincula—, así que el candado le caía justo al que ya
      // se había esforzado. Ahora `claimPetsIntoAccount` traslada lo suyo al
      // registro consolidado. Puede quedar el mismo perro dos veces; eso se ve
      // y se arregla, perder la vinculación no.

      const selectedPetIds = Array.isArray(request.body?.petIds)
        ? [
            ...new Set(
              request.body!.petIds.filter(
                (id) => typeof id === "string" && id.length > 0
              )
            ),
          ]
        : [];

      // Autorización: SOLO el token que entregó /verify tras el código. Antes
      // bastaba con repetir el teléfono (o mandar un `candidateId`) para
      // apropiarse de la ficha; esas dos puertas quedan cerradas. Las apps
      // anteriores a este cambio reciben un mensaje claro para actualizar.
      const allowedIds = request.body?.claimToken
        ? readClaimToken(request.body.claimToken, fresh.id)
        : null;
      if (!allowedIds || allowedIds.length === 0) {
        return reply.status(403).send({
          error:
            "Para vincular tu cuenta necesitas el código que te enviamos por correo. Vuelve a buscar tu cuenta; si tu app no te pide el código, actualízala.",
          code: "CLAIM_CODE_REQUIRED",
        });
      }
      if (selectedPetIds.length === 0) {
        return reply
          .status(400)
          .send({ error: "Selecciona al menos una mascota" });
      }
      const petIds = selectedPetIds;

      const enteredPhone = request.body?.phone?.trim() || null;
      try {
        const merged = await claimPetsIntoAccount(
          prisma,
          fresh,
          petIds,
          allowedIds,
          enteredPhone
        );
        // El merge puede cambiar datos del usuario (teléfono, nombre) — el
        // siguiente /users/me debe leer la versión consolidada.
        invalidateAuthCache(fresh.clerkId);
        return reply.send(merged);
      } catch (err) {
        if (err instanceof ClaimForbiddenError) {
          return reply.status(403).send({ error: err.message });
        }
        if (err instanceof ClaimUnavailableError) {
          return reply.status(409).send({ error: err.message });
        }
        throw err;
      }
    }
  );

  // PATCH /users/me — actualizar perfil propio (firstName, lastName, phone)
  fastify.patch<{
    Body: { firstName?: string; lastName?: string; phone?: string | null };
  }>(
    "/users/me",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const userId = request.userId!;
      const { firstName, lastName, phone } = request.body ?? {};
      const data: { firstName?: string; lastName?: string; phone?: string | null } = {};
      if (typeof firstName === "string" && firstName.trim().length > 0) {
        data.firstName = firstName.trim();
      }
      if (typeof lastName === "string" && lastName.trim().length > 0) {
        data.lastName = lastName.trim();
      }
      if (phone === null) {
        data.phone = null;
      } else if (typeof phone === "string") {
        data.phone = phone.trim().length > 0 ? phone.trim() : null;
      }
      if (Object.keys(data).length === 0) {
        return reply.status(400).send({ error: "Nada para actualizar" });
      }
      const updated = await prisma.user.update({ where: { id: userId }, data });
      invalidateAuthCache(updated.clerkId);
      return updated;
    }
  );

  // GET /users/me/export — export completo de los datos del usuario (derecho ARCO de Acceso)
  fastify.get(
    "/users/me/export",
    { preHandler: [authMiddleware] },
    async (request) => {
      const userId = request.userId!;
      const [user, pets, reservations, payments, notifications, legalAcceptances, creditEntries, reviews] =
        await Promise.all([
          prisma.user.findUnique({ where: { id: userId } }),
          prisma.pet.findMany({
            where: { ownerId: userId },
            include: { vaccines: true },
          }),
          prisma.reservation.findMany({ where: { ownerId: userId } }),
          prisma.payment.findMany({ where: { userId } }),
          prisma.notification.findMany({ where: { userId } }),
          prisma.legalAcceptance.findMany({ where: { userId } }),
          prisma.creditLedger.findMany({ where: { userId } }),
          prisma.review.findMany({ where: { ownerId: userId } }),
        ]);

      return {
        exportedAt: new Date().toISOString(),
        user,
        pets,
        reservations,
        payments,
        notifications,
        legalAcceptances,
        creditEntries,
        reviews,
      };
    }
  );

  // DELETE /users/me — eliminaci\u00f3n de cuenta del usuario autenticado (derecho ARCO de Cancelaci\u00f3n)
  // Apple Guideline 5.1.1(v) requiere que los usuarios puedan eliminar su cuenta desde dentro del app.
  fastify.delete(
    "/users/me",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const userId = request.userId!;
      const clerkId = request.dbUser?.clerkId ?? null;

      // Bloquear si hay reservaciones activas: el usuario no puede desaparecer mientras tenemos su perro.
      const now = new Date();
      const activeReservation = await prisma.reservation.findFirst({
        where: {
          ownerId: userId,
          status: { in: ["CONFIRMED", "CHECKED_IN"] },
          checkOut: { gte: now },
        },
      });
      if (activeReservation) {
        return reply.status(409).send({
          error: "ACTIVE_RESERVATION",
          message:
            "Tienes una reservaci\u00f3n activa o pr\u00f3xima. Cancélala antes de eliminar tu cuenta.",
          reservationId: activeReservation.id,
        });
      }

      const allPets = await prisma.pet.findMany({
        where: { ownerId: userId },
        select: { id: true },
      });

      // Las mascotas COMPARTIDAS no se anonimizan: son también de otra persona,
      // que las sigue usando. Se le traspasa la propiedad al primer co-dueño y
      // quedan fuera del borrado de vacunas, evidencias e historial. Sin esto,
      // que uno de los dos borre su cuenta le desaparecería el perro al otro.
      const coOwnedRows = await prisma.petCoOwner.findMany({
        where: { petId: { in: allPets.map((p) => p.id) } },
        orderBy: { createdAt: "asc" },
        select: { petId: true, userId: true },
      });
      const heirByPet = new Map<string, string>();
      for (const row of coOwnedRows) {
        if (!heirByPet.has(row.petId)) heirByPet.set(row.petId, row.userId);
      }

      const pets = allPets.filter((p) => !heirByPet.has(p.id));
      const petIds = pets.map((p) => p.id);
      const reservations = await prisma.reservation.findMany({
        where: { ownerId: userId },
        select: { id: true },
      });
      const reservationIds = reservations.map((r) => r.id);

      // Anonimizar PII pero conservar registros vinculados a pagos/reservaciones por retenci\u00f3n fiscal (5 a\u00f1os LFPDPPP).
      await prisma.$transaction(async (tx) => {
        // Las invitaciones que mandó esta persona (o las de sus perros) dejan de
        // servir: quien las emitió ya no existe, y un perro traspasado quedaría
        // recibiendo gente que su nuevo dueño nunca invitó. Se anonimiza en vez
        // de borrar, así que el cascade de `invitedById` nunca correría.
        await tx.petInvite.updateMany({
          where: {
            OR: [{ invitedById: userId }, { petId: { in: allPets.map((p) => p.id) } }],
            acceptedAt: null,
            revokedAt: null,
          },
          data: { revokedAt: new Date(), revokedById: userId },
        });

        // Traspaso de las compartidas antes de tocar nada más: el co-dueño pasa
        // a ser el dueño y deja de estar en la tabla puente.
        for (const [petId, heirId] of heirByPet) {
          await tx.pet.update({ where: { id: petId }, data: { ownerId: heirId } });
          await tx.petCoOwner.deleteMany({ where: { petId, userId: heirId } });
        }
        await tx.petCoOwner.deleteMany({ where: { userId } });

        await tx.pushToken.deleteMany({ where: { userId } });
        await tx.notification.deleteMany({ where: { userId } });
        await tx.legalAcceptance.deleteMany({ where: { userId } });
        await tx.creditLedger.deleteMany({ where: { userId } });
        await tx.review.deleteMany({ where: { ownerId: userId } });

        if (petIds.length > 0) {
          await tx.vaccine.deleteMany({ where: { petId: { in: petIds } } });
          await tx.behaviorTag.deleteMany({ where: { petId: { in: petIds } } });
          await tx.staffAlert.deleteMany({ where: { petId: { in: petIds } } });
          await tx.stayUpdate.deleteMany({ where: { petId: { in: petIds } } });
        }
        if (reservationIds.length > 0) {
          await tx.dailyChecklist.deleteMany({
            where: { reservationId: { in: reservationIds } },
          });
        }

        // Anonimizar mascotas (no se borran porque reservaciones mantienen FK por motivos fiscales).
        if (petIds.length > 0) {
          await tx.pet.updateMany({
            where: { id: { in: petIds } },
            data: {
              name: "Mascota eliminada",
              breed: null,
              photoUrl: null,
              notes: null,
              sex: null,
              behavior: null,
              walkPreference: null,
              healthIssues: null,
              emergencyContactName: null,
              emergencyContactPhone: null,
              emergencyContactRelation: null,
              vetName: null,
              vetPhone: null,
              feedingSchedule: null,
              feedingAmount: null,
              foodType: null,
              feedingInstructions: null,
              diet: null,
              personality: null,
              cartillaUrl: null,
              cartillaStatus: null,
              cartillaReviewedAt: null,
              cartillaReviewedById: null,
              cartillaRejectionReason: null,
              isActive: false,
            },
          });
        }

        // Anonimizar usuario (conserva id para integridad referencial de pagos/reservaciones pasadas).
        await tx.user.update({
          where: { id: userId },
          data: {
            clerkId: null,
            email: `deleted-${userId}@holidoginn.deleted`,
            phone: null,
            firstName: "Usuario",
            lastName: "Eliminado",
            avatarUrl: null,
            isActive: false,
          },
        });
      });

      // Borrar usuario en Clerk para que no pueda iniciar sesi\u00f3n nuevamente.
      // Si esto falla, la cuenta ya qued\u00f3 anonimizada en BD — solo logueamos.
      // La cuenta anonimizada no debe seguir resolviendo desde el caché.
      invalidateAuthCache(clerkId);

      if (clerkId) {
        try {
          await clerkClient.users.deleteUser(clerkId);
        } catch (err) {
          request.log.error({ err, clerkId }, "Fall\u00f3 borrar usuario en Clerk");
        }
      }

      return reply.status(200).send({ ok: true });
    }
  );

  // GET /users/me/credit-ledger — historial de saldo a favor del usuario autenticado
  fastify.get(
    "/users/me/credit-ledger",
    { preHandler: [createAuthMiddleware(prisma)] },
    async (request, reply) => {
      const entries = await prisma.creditLedger.findMany({
        where: { userId: request.userId! },
        orderBy: { createdAt: "desc" },
      });
      return entries;
    }
  );

  // PATCH /users/me/role — dev-only, permite al usuario autenticado cambiar su propio rol
  fastify.patch(
    "/users/me/role",
    { preHandler: [createAuthMiddleware(prisma)] },
    async (request, reply) => {
      if (process.env.NODE_ENV === "production") {
        return reply.status(403).send({ error: "forbidden in production" });
      }

      const parsed = UpdateUserSchema.pick({ role: true }).safeParse(
        request.body
      );
      if (!parsed.success || !parsed.data.role) {
        return reply.status(400).send({ error: "role requerido" });
      }

      const updated = await prisma.user.update({
        where: { id: request.userId! },
        data: { role: parsed.data.role },
      });
      invalidateAuthCache(updated.clerkId);
      return updated;
    }
  );

  // GET /users/:id — obtener uno (solo admin)
  fastify.get<{ Params: { id: string } }>(
    "/users/:id",
    { preHandler: adminAuth },
    async (request, reply) => {
      const user = await prisma.user.findUnique({
        where: { id: request.params.id },
        include: { pets: true },
      });
      if (!user) {
        return reply.status(404).send({ error: "Usuario no encontrado" });
      }
      return user;
    }
  );

  // POST /users — crear (admin y staff). Pensado para dar de alta clientes
  // walk-in desde el mostrador: el email es opcional (se genera el mismo
  // placeholder @holidoginn.local que usa el admin web) y el teléfono se
  // checa contra duplicados con la normalización del claim (últimos 10
  // dígitos) para no repetir el problema de clientes duplicados.
  fastify.post("/users", { preHandler: staffAuth }, async (request, reply) => {
    const raw = { ...((request.body ?? {}) as Record<string, unknown>) };
    if (typeof raw.email !== "string" || !raw.email.trim()) {
      raw.email = `walkin+${randomUUID()}@holidoginn.local`;
    }
    // `role` viaja en el body y el schema lo acepta (default OWNER). Ahora que
    // STAFF puede llegar aquí, ignorarlo sería dejarle crearse un ADMIN: solo
    // un admin decide el rol de quien se da de alta.
    if (request.userRole !== "ADMIN") {
      raw.role = "OWNER";
    }

    const parsed = CreateUserSchema.safeParse(raw);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const phone = normalizePhone(parsed.data.phone);
    if (phone) {
      const [dup] = await prisma.$queryRaw<
        { firstName: string; lastName: string }[]
      >`
        SELECT "firstName", "lastName" FROM users
        WHERE "isActive" = true
          AND right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = ${phone}
        LIMIT 1
      `;
      if (dup) {
        const dupName = `${dup.firstName} ${dup.lastName}`.trim();
        return reply.status(409).send({
          error: `Ese teléfono ya pertenece a ${dupName}. Búscalo en la lista para no duplicarlo.`,
        });
      }
    }

    const existing = await prisma.user.findUnique({
      where: { email: parsed.data.email },
    });
    if (existing) {
      return reply
        .status(409)
        .send({ error: "Ya existe un usuario con ese email" });
    }

    const user = await prisma.user.create({ data: parsed.data });
    return reply.status(201).send(user);
  });

  // PATCH /users/:id — actualizar (solo admin).
  // Sin checks previos de existencia/email: el update es la única query y los
  // errores de Prisma se mapean a los mismos status (P2025→404, P2002→409).
  // Antes eran 2-3 findUnique seriales extra por cada cambio de rol.
  fastify.patch<{ Params: { id: string } }>(
    "/users/:id",
    { preHandler: adminAuth },
    async (request, reply) => {
      const parsed = UpdateUserSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      try {
        const updated = await prisma.user.update({
          where: { id: request.params.id },
          data: parsed.data,
        });
        // Cambios de rol/isActive deben aplicar de inmediato en el middleware.
        invalidateAuthCache(updated.clerkId);
        return updated;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError) {
          if (err.code === "P2025") {
            return reply.status(404).send({ error: "Usuario no encontrado" });
          }
          if (err.code === "P2002") {
            return reply
              .status(409)
              .send({ error: "Ya existe un usuario con ese email" });
          }
        }
        throw err;
      }
    }
  );

  // DELETE /users/:id — desactivar (soft delete, solo admin)
  fastify.delete<{ Params: { id: string } }>(
    "/users/:id",
    { preHandler: adminAuth },
    async (request, reply) => {
      try {
        const updated = await prisma.user.update({
          where: { id: request.params.id },
          data: { isActive: false },
        });
        // La desactivación debe cortar el acceso al instante, no tras el TTL.
        invalidateAuthCache(updated.clerkId);
        return updated;
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2025"
        ) {
          return reply.status(404).send({ error: "Usuario no encontrado" });
        }
        throw err;
      }
    }
  );
}
