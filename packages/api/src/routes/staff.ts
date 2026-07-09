import { FastifyInstance, FastifyRequest } from "fastify";
import { Prisma, ReservationStatus } from "@holidoginn/db";
import {
  createAuthMiddleware,
  createStaffMiddleware,
} from "../middleware/auth";
import {
  CreateDailyChecklistSchema,
  UpdateDailyChecklistSchema,
  CreateBehaviorTagSchema,
  CreateStaffAlertSchema,
  CreateStayUpdateSchema,
} from "@holidoginn/shared";
import { notifyUser, notifyUsers } from "../lib/notify";
import { triggerMaintenance } from "../lib/maintenance";
import { maybeConcludeStandaloneBath } from "./baths";

export default async function staffRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const authMiddleware = createAuthMiddleware(prisma);
  const staffMiddleware = createStaffMiddleware();
  const preHandler = [authMiddleware, staffMiddleware];

  // Helper: send daily checklist reminder to staff (once per day per stay)
  async function sendChecklistReminders(staffId: string) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // Find active stays assigned to this staff without today's checklist
    const staysWithoutChecklist = await prisma.reservation.findMany({
      where: {
        reservationType: "STAY",
        staffId,
        status: "CHECKED_IN",
        checklists: { none: { date: todayStart } },
      },
      include: { pet: { select: { name: true } } },
    });

    if (staysWithoutChecklist.length === 0) return;

    // Check if we already sent a reminder today for this staff
    const existingReminder = await prisma.notification.findFirst({
      where: {
        userId: staffId,
        type: "CHECKLIST_REMINDER",
        createdAt: { gte: todayStart },
      },
    });
    if (existingReminder) return;

    const petNames = staysWithoutChecklist.map((s) => s.pet.name).join(", ");
    await notifyUser(prisma, {
      userId: staffId,
      type: "CHECKLIST_REMINDER",
      title: "Reportes diarios pendientes 📋",
      body: `Faltan reportes de hoy para: ${petNames}. No olvides llenarlos.`,
      data: {
        reservationIds: staysWithoutChecklist.map((s) => s.id),
      },
    });
  }

  // ─── GET /staff/stays — estancias activas ─────────────────────

  fastify.get<{
    Querystring: { status?: string; all?: string };
  }>("/staff/stays", { preHandler }, async (request) => {
    triggerMaintenance(prisma);
    // `?all=true` → cualquier staff ve todas las estancias (no solo las
    // asignadas a él) y todos los status excepto CANCELLED. Usado por el
    // calendario de staff para ver agenda completa de hotel.
    const isAll = request.query.all === "true";
    const status = request.query.status || (isAll ? undefined : "CHECKED_IN");
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // Send checklist reminders (non-blocking, once per day)
    if (status === "CHECKED_IN" && request.userId) {
      sendChecklistReminders(request.userId).catch(() => {});
    }

    const stays = await prisma.reservation.findMany({
      where: {
        reservationType: "STAY",
        ...(status
          ? { status: status as ReservationStatus }
          : { status: { not: "CANCELLED" } }),
        ...(request.userRole === "STAFF" && !isAll
          ? { staffId: request.userId }
          : {}),
      },
      include: {
        pet: {
          include: {
            vaccines: true,
            owner: {
              select: { id: true, firstName: true, lastName: true, email: true, phone: true },
            },
          },
        },
        room: true,
        owner: {
          select: { id: true, firstName: true, lastName: true, email: true, phone: true },
        },
        checklists: {
          where: { date: todayStart },
          take: 1,
        },
        updates: {
          where: { createdAt: { gte: todayStart } },
          orderBy: { createdAt: "desc" },
        },
        staff: {
          select: { id: true, firstName: true, lastName: true },
        },
        addons: {
          include: { variant: { include: { serviceType: true } } },
        },
      },
      orderBy: { checkIn: "asc" },
    });

    return stays;
  });

  // ─── GET /staff/me/stats — métricas personales del staff ────────

  fastify.get("/staff/me/stats", { preHandler }, async (request, reply) => {
    const staffId = request.userId;
    if (!staffId) {
      return reply.status(401).send({ error: "No autorizado" });
    }

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [
      user,
      totalStays,
      monthStays,
      checklists,
      updates,
      alertsReported,
      alertsResolved,
    ] = await Promise.all([
      prisma.user.findUnique({
        where: { id: staffId },
        select: { createdAt: true },
      }),
      prisma.reservation.count({
        where: { staffId, status: "CHECKED_OUT" },
      }),
      prisma.reservation.count({
        where: {
          staffId,
          status: "CHECKED_OUT",
          updatedAt: { gte: monthStart },
        },
      }),
      prisma.dailyChecklist.count({ where: { staffId } }),
      prisma.stayUpdate.count({ where: { staffId } }),
      prisma.staffAlert.count({ where: { staffId } }),
      prisma.staffAlert.count({
        where: { staffId, isResolved: true },
      }),
    ]);

    return {
      memberSince: user?.createdAt ?? null,
      totalStays,
      monthStays,
      checklists,
      updates,
      alertsReported,
      alertsResolved,
    };
  });

  // ─── GET /staff/stays/unassigned — estancias sin staff asignado ──

  fastify.get("/staff/stays/unassigned", { preHandler }, async () => {
    const stays = await prisma.reservation.findMany({
      where: {
        reservationType: "STAY",
        status: { in: ["CONFIRMED", "CHECKED_IN"] },
        staffId: null,
      },
      include: {
        pet: { select: { id: true, name: true, breed: true, photoUrl: true, size: true } },
        room: { select: { id: true, name: true } },
        owner: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { checkIn: "asc" },
    });

    return stays;
  });

  // ─── GET /staff/stays/:id — detalle de estancia ──────────────

  fastify.get<{ Params: { id: string } }>(
    "/staff/stays/:id",
    { preHandler },
    async (request, reply) => {
      const { id } = request.params;

      const stay = await prisma.reservation.findUnique({
        where: { id },
        include: {
          pet: {
            include: {
              vaccines: { orderBy: { expiresAt: "asc" } },
              behaviorTags: { orderBy: { createdAt: "desc" } },
              owner: {
                select: { id: true, firstName: true, lastName: true, email: true, phone: true },
              },
            },
          },
          room: true,
          owner: {
            select: { id: true, firstName: true, lastName: true, email: true, phone: true },
          },
          checklists: {
            orderBy: { date: "desc" },
            include: {
              staff: { select: { id: true, firstName: true, lastName: true } },
            },
          },
          updates: {
            orderBy: { createdAt: "desc" },
          },
          alerts: {
            orderBy: { createdAt: "desc" },
            include: {
              staff: { select: { id: true, firstName: true, lastName: true } },
            },
          },
          staff: {
            select: { id: true, firstName: true, lastName: true },
          },
          addons: {
            include: { variant: { include: { serviceType: true } } },
            orderBy: { createdAt: "desc" },
          },
          changeRequests: {
            orderBy: { createdAt: "desc" },
          },
          // Pagos recibidos (PAID + PARTIAL=anticipo) para calcular saldo
          // pendiente en el mobile. El anticipo se queda como PARTIAL
          // permanente y los pagos siguientes son PAID — ambos representan
          // dinero efectivamente cobrado.
          payments: {
            where: { status: { in: ["PAID", "PARTIAL"] } },
            select: {
              id: true,
              amount: true,
              method: true,
              status: true,
              paidAt: true,
            },
            orderBy: { paidAt: "desc" },
          },
        },
      });

      if (!stay) {
        return reply.status(404).send({ error: "Estancia no encontrada" });
      }

      // Cualquier staff puede VER cualquier estancia: el calendario muestra la
      // agenda completa y las acciones (assign/checkin/checkout) tampoco
      // filtran por asignación — el responsable es accountability, no acceso.
      // (Antes un 403 aquí dejaba al staff en un callejón sin salida al abrir
      // estancias asignadas a un compañero.)
      return stay;
    }
  );

  // ─── POST /staff/stays/:id/assign — asignarse como responsable ─

  fastify.post<{ Params: { id: string } }>(
    "/staff/stays/:id/assign",
    { preHandler },
    async (request, reply) => {
      const { id } = request.params;

      const reservation = await prisma.reservation.findUnique({
        where: { id },
      });

      if (!reservation) {
        return reply.status(404).send({ error: "Reservación no encontrada" });
      }

      if (!["CONFIRMED", "CHECKED_IN"].includes(reservation.status)) {
        return reply
          .status(400)
          .send({ error: "Solo se puede asignar a estancias confirmadas o activas" });
      }

      const updated = await prisma.reservation.update({
        where: { id },
        data: { staffId: request.userId! },
        include: {
          pet: { select: { name: true } },
          staff: { select: { firstName: true, lastName: true } },
        },
      });

      return updated;
    }
  );

  // ─── POST /staff/stays/:id/checkin — check-in + notificación ──

  fastify.post<{ Params: { id: string } }>(
    "/staff/stays/:id/checkin",
    { preHandler },
    async (request, reply) => {
      const { id } = request.params;

      const reservation = await prisma.reservation.findUnique({
        where: { id },
        include: { pet: { select: { name: true } } },
      });

      if (!reservation) {
        return reply.status(404).send({ error: "Reservación no encontrada" });
      }

      if (reservation.status !== "CONFIRMED") {
        return reply
          .status(400)
          .send({ error: "Solo se puede hacer check-in a reservaciones confirmadas" });
      }

      const updated = await prisma.reservation.update({
        where: { id },
        data: {
          status: "CHECKED_IN",
          staffId: reservation.staffId || request.userId!,
        },
      });

      // Notificación al dueño (in-app + push)
      await notifyUser(prisma, {
        userId: reservation.ownerId,
        type: "CHECK_IN",
        title: "Tu mascota ya está hospedada",
        body: `${reservation.pet.name} ya se encuentra en HolidogInn. Estamos al pendiente, te enviaremos actualizaciones diarias 🐾`,
        data: { reservationId: id },
      });

      return updated;
    }
  );

  // ─── POST /staff/stays/:id/checkout — check-out + validación ──

  fastify.post<{ Params: { id: string } }>(
    "/staff/stays/:id/checkout",
    { preHandler },
    async (request, reply) => {
      const { id } = request.params;

      const reservation = await prisma.reservation.findUnique({
        where: { id },
        include: {
          pet: { select: { name: true } },
          checklists: true,
          updates: true,
          alerts: { where: { isResolved: false } },
        },
      });

      if (!reservation) {
        return reply.status(404).send({ error: "Reservación no encontrada" });
      }

      if (reservation.status !== "CHECKED_IN") {
        return reply
          .status(400)
          .send({ error: "Solo se puede hacer check-out a estancias activas" });
      }

      // Validar completitud
      const warnings: string[] = [];
      if (reservation.checklists.length === 0) {
        warnings.push("No hay reportes diarios registrados");
      }
      if (reservation.updates.length === 0) {
        warnings.push("No hay evidencias (fotos/videos) registradas");
      }
      if (reservation.alerts.length > 0) {
        warnings.push(
          `Hay ${reservation.alerts.length} alerta(s) sin resolver`
        );
      }

      const updated = await prisma.$transaction(async (tx) => {
        const res = await tx.reservation.update({
          where: { id },
          data: { status: "CHECKED_OUT" },
        });
        await tx.reservationChangeRequest.updateMany({
          where: { reservationId: id, status: "PENDING" },
          data: { status: "CANCELLED", rejectionReason: "Reservación finalizada" },
        });
        return res;
      });

      // Notificación al dueño (in-app + push)
      await notifyUser(prisma, {
        userId: reservation.ownerId,
        type: "CHECK_OUT",
        title: `${reservation.pet.name} ya salió 🐾`,
        body: `La estancia de ${reservation.pet.name} ha finalizado. Gracias por confiar en nosotros, nos vemos pronto.`,
        data: { reservationId: id },
      });

      // Solicitud de reseña (in-app + push)
      await notifyUser(prisma, {
        userId: reservation.ownerId,
        type: "REVIEW_REQUEST",
        title: "¿Cómo fue la experiencia? ⭐",
        body: `Cuéntanos sobre la estancia de ${reservation.pet.name}. Tu reseña nos ayuda a mejorar.`,
        data: { reservationId: id },
      });

      return { reservation: updated, warnings };
    }
  );

  // ─── POST /staff/stays/:id/register-manual-payment ────────────
  //  Staff registra un pago manual (efectivo/transferencia) para una
  //  estancia. Útil cuando el owner paga el saldo del anticipo al hacer
  //  check-in. Soporta pagos parciales: el staff puede registrar varios.
  fastify.post<{
    Params: { id: string };
    Body: { amount?: number; method?: "CASH" | "TRANSFER"; notes?: string };
  }>(
    "/staff/stays/:id/register-manual-payment",
    { preHandler },
    async (request, reply) => {
      const method = request.body?.method ?? "CASH";
      const amount = request.body?.amount;
      if (!["CASH", "TRANSFER"].includes(method)) {
        return reply.status(400).send({ error: "Método inválido" });
      }
      if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
        return reply.status(400).send({
          error: "El monto debe ser un número mayor a 0",
        });
      }

      const reservation = await prisma.reservation.findUnique({
        where: { id: request.params.id },
        include: {
          pet: { select: { id: true, name: true } },
          payments: { where: { status: { in: ["PAID", "PARTIAL"] } } },
        },
      });
      if (!reservation) {
        return reply.status(404).send({ error: "Estancia no encontrada" });
      }
      if (reservation.reservationType !== "STAY") {
        return reply.status(400).send({
          error: "Este endpoint sólo aplica a estancias (hospedaje)",
        });
      }
      if (reservation.status === "CANCELLED") {
        return reply.status(400).send({ error: "La reservación está cancelada" });
      }
      // Solo el staff asignado (o admin) puede registrar pagos.
      if (
        request.userRole === "STAFF" &&
        reservation.staffId !== null &&
        reservation.staffId !== request.userId
      ) {
        return reply
          .status(403)
          .send({ error: "Esta estancia no está asignada a ti" });
      }

      const totalPaidBefore = reservation.payments.reduce(
        (sum, p) => sum + Number(p.amount),
        0,
      );
      const balance = Math.max(
        0,
        Number(reservation.totalAmount) - totalPaidBefore,
      );
      if (balance <= 0.01) {
        return reply.status(400).send({
          error: "No hay saldo pendiente para registrar.",
        });
      }
      // Tolerar un sobrepago de hasta 1 peso (centavos por redondeo).
      if (amount - balance > 1) {
        return reply.status(400).send({
          error: `El monto excede el saldo pendiente ($${balance.toLocaleString(
            "es-MX",
          )}).`,
        });
      }

      const noteText =
        request.body?.notes?.trim() ||
        `Pago manual (${method}) registrado por staff`;

      const payment = await prisma.payment.create({
        data: {
          amount: new Prisma.Decimal(amount),
          method,
          status: "PAID",
          paidAt: new Date(),
          reservationId: reservation.id,
          userId: reservation.ownerId,
          notes: noteText,
        },
      });

      await notifyUser(prisma, {
        userId: reservation.ownerId,
        type: "GENERAL",
        title: "Pago recibido",
        body: `Recibimos $${amount.toLocaleString("es-MX")} de la estancia de ${reservation.pet.name}. ¡Gracias!`,
        data: { reservationId: reservation.id, kind: "STAY_PAID" },
      });

      return reply.send({ success: true, amount, payment });
    },
  );

  // ─── POST /staff/checklists — crear reporte diario ────────────

  fastify.post(
    "/staff/checklists",
    { preHandler },
    async (request, reply) => {
      const body = request.body as Record<string, unknown> | null;
      // Acepta `mediaItems: Array<{ url, type }>` (preferido), o
      // `mediaUrls: string[]` / `mediaUrl: string` (legacy, se asumen imágenes).
      // Cada item se crea como un StayUpdate sin reemplazar los anteriores
      // del día — permite varias fotos/videos por reporte.
      const rawItems: Array<{ url: string; type: "image" | "video" }> =
        Array.isArray(body?.mediaItems)
          ? (body!.mediaItems as unknown[])
              .map((it) => {
                if (it && typeof it === "object") {
                  const o = it as Record<string, unknown>;
                  if (
                    typeof o.url === "string" &&
                    o.url.startsWith("http") &&
                    (o.type === "image" || o.type === "video")
                  ) {
                    return { url: o.url, type: o.type };
                  }
                }
                return null;
              })
              .filter((x): x is { url: string; type: "image" | "video" } => !!x)
          : (Array.isArray(body?.mediaUrls)
              ? body!.mediaUrls
              : typeof body?.mediaUrl === "string"
                ? [body.mediaUrl]
                : []
            )
              .filter(
                (u): u is string =>
                  typeof u === "string" && u.startsWith("http"),
              )
              .map((url) => ({ url, type: "image" as const }));
      if (rawItems.length === 0) {
        return reply.status(400).send({
          error: "Se requiere al menos una foto o video para guardar el reporte",
        });
      }

      const parsed = CreateDailyChecklistSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const data = parsed.data;

      // Verificar que la reservación existe y está activa
      const reservation = await prisma.reservation.findUnique({
        where: { id: data.reservationId },
        include: { pet: { select: { id: true, name: true } } },
      });

      if (!reservation) {
        return reply.status(404).send({ error: "Reservación no encontrada" });
      }

      if (reservation.status !== "CHECKED_IN") {
        return reply
          .status(400)
          .send({ error: "Solo se pueden crear reportes para estancias activas" });
      }

      // Contar evidencias del día (incluye la nueva foto que se va a crear).
      // Trunca en UTC (no en la TZ del server) para que el "día" sea el del
      // cliente, no el de Railway/Europa, y no colisione con el día anterior.
      const dateStart = new Date(data.date);
      dateStart.setUTCHours(0, 0, 0, 0);
      const dateEnd = new Date(dateStart.getTime() + 86_400_000);

      // El caption público no debe incluir el bloque [HANDOFF] (notas internas de relevo entre staff).
      const publicCaption = data.additionalNotes
        ? data.additionalNotes.replace(/\n?\[HANDOFF\] [\s\S]*/, "").trim() || null
        : null;

      const checklist = await prisma.$transaction(async (tx) => {
        await tx.stayUpdate.createMany({
          data: rawItems.map((it) => ({
            reservationId: data.reservationId,
            petId: reservation.pet.id,
            staffId: request.userId!,
            mediaUrl: it.url,
            mediaType: it.type,
            caption: publicCaption,
          })),
        });

        const [photosCount, videosCount] = await Promise.all([
          tx.stayUpdate.count({
            where: {
              reservationId: data.reservationId,
              mediaType: "image",
              createdAt: { gte: dateStart, lt: dateEnd },
            },
          }),
          tx.stayUpdate.count({
            where: {
              reservationId: data.reservationId,
              mediaType: "video",
              createdAt: { gte: dateStart, lt: dateEnd },
            },
          }),
        ]);

        return tx.dailyChecklist.upsert({
          where: {
            reservationId_date: {
              reservationId: data.reservationId,
              date: dateStart,
            },
          },
          create: {
            ...data,
            date: dateStart,
            staffId: request.userId!,
            photosCount,
            videosCount,
          },
          update: {
            ...data,
            date: undefined,
            reservationId: undefined,
            photosCount,
            videosCount,
          },
        });
      });

      // Notificación al dueño
      const moodConfig: Record<string, { emoji: string; label: string }> = {
        SAD: { emoji: "😢", label: "triste" },
        NEUTRAL: { emoji: "😐", label: "tranquilo" },
        HAPPY: { emoji: "😊", label: "feliz" },
        EXCITED: { emoji: "🤩", label: "emocionado" },
      };
      const m = moodConfig[data.mood] ?? moodConfig.HAPPY;
      const ownerNote = (data.additionalNotes ?? "")
        .replace(/\n?\[HANDOFF\] [\s\S]*/, "")
        .trim();
      const hasVideo = rawItems.some((it) => it.type === "video");
      const hasImage = rawItems.some((it) => it.type === "image");
      const evidenceLabel =
        hasVideo && hasImage
          ? "fotos y videos nuevos"
          : hasVideo
            ? rawItems.length > 1 ? "videos nuevos" : "video nuevo"
            : rawItems.length > 1 ? "fotos nuevas" : "foto nueva";
      const evidenceIcon = hasVideo ? "🎥" : "📸";
      const tail = ownerNote.length > 0
        ? `${ownerNote} Hay ${evidenceLabel} ${evidenceIcon}`
        : `Sube a la app para ver ${evidenceLabel} del día ${evidenceIcon}`;

      await notifyUser(prisma, {
        userId: reservation.ownerId,
        type: "DAILY_REPORT",
        title: `Reporte de ${reservation.pet.name}`,
        body: `${m.emoji} Hoy está ${m.label}. ${tail}`,
        data: { reservationId: data.reservationId, checklistId: checklist.id },
      });

      return reply.status(201).send(checklist);
    }
  );

  // ─── GET /staff/checklists/:reservationId — historial ─────────

  fastify.get<{ Params: { reservationId: string } }>(
    "/staff/checklists/:reservationId",
    { preHandler },
    async (request) => {
      const { reservationId } = request.params;

      const checklists = await prisma.dailyChecklist.findMany({
        where: { reservationId },
        orderBy: { date: "desc" },
        include: {
          staff: { select: { id: true, firstName: true, lastName: true } },
        },
      });

      return checklists;
    }
  );

  // ─── PATCH /staff/checklists/:id — editar checklist ───────────

  fastify.patch<{ Params: { id: string } }>(
    "/staff/checklists/:id",
    { preHandler },
    async (request, reply) => {
      const parsed = UpdateDailyChecklistSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const checklist = await prisma.dailyChecklist.findUnique({
        where: { id: request.params.id },
      });

      if (!checklist) {
        return reply.status(404).send({ error: "Checklist no encontrado" });
      }

      const updated = await prisma.dailyChecklist.update({
        where: { id: request.params.id },
        data: parsed.data,
      });

      return updated;
    }
  );

  // ─── POST /staff/stay-updates — subir evidencia ───────────────

  fastify.post(
    "/staff/stay-updates",
    { preHandler },
    async (request, reply) => {
      const parsed = CreateStayUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const data = parsed.data;

      const reservation = await prisma.reservation.findUnique({
        where: { id: data.reservationId },
      });

      if (!reservation) {
        return reply.status(404).send({ error: "Reservación no encontrada" });
      }

      const update = await prisma.stayUpdate.create({
        data: {
          ...data,
          staffId: request.userId!,
        },
      });

      // Si existe un DailyChecklist para el día de esta evidencia, recontar
      // sus photosCount/videosCount para mantenerlo sincronizado con los
      // StayUpdates reales del día (incluyendo el que acabamos de crear).
      // El día se ancla en UTC para consistencia con cómo se guarda
      // `DailyChecklist.date` desde el form.
      const dayStart = new Date(update.createdAt);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart.getTime() + 86_400_000);
      const existingChecklist = await prisma.dailyChecklist.findUnique({
        where: {
          reservationId_date: {
            reservationId: data.reservationId,
            date: dayStart,
          },
        },
      });
      if (existingChecklist) {
        const [photosCount, videosCount] = await Promise.all([
          prisma.stayUpdate.count({
            where: {
              reservationId: data.reservationId,
              mediaType: "image",
              createdAt: { gte: dayStart, lt: dayEnd },
            },
          }),
          prisma.stayUpdate.count({
            where: {
              reservationId: data.reservationId,
              mediaType: "video",
              createdAt: { gte: dayStart, lt: dayEnd },
            },
          }),
        ]);
        await prisma.dailyChecklist.update({
          where: { id: existingChecklist.id },
          data: { photosCount, videosCount },
        });
      }

      // Notificación al dueño de nueva evidencia
      const pet = await prisma.pet.findUnique({
        where: { id: data.petId },
        select: { name: true },
      });

      // El texto cambia según el tipo de reservación — "estancia" no aplica
      // para baños sueltos.
      const mediaWord = data.mediaType === "video" ? "video" : "foto";
      const context = reservation.reservationType === "BATH" ? "baño" : "estancia";
      await notifyUser(prisma, {
        userId: reservation.ownerId,
        type: "NEW_UPDATE",
        title: `Nueva ${mediaWord} de ${pet?.name ?? "tu mascota"}`,
        body:
          data.caption ||
          `Se ha subido una nueva ${mediaWord} del ${context}.`,
        data: { reservationId: data.reservationId, updateId: update.id },
      });

      return reply.status(201).send(update);
    }
  );

  // ─── POST /staff/alerts — crear alerta para admin ─────────────

  fastify.post(
    "/staff/alerts",
    { preHandler },
    async (request, reply) => {
      const parsed = CreateStaffAlertSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const data = parsed.data;

      const alert = await prisma.staffAlert.create({
        data: {
          ...data,
          staffId: request.userId!,
        },
      });

      // Notificar a todos los admins
      const admins = await prisma.user.findMany({
        where: { role: "ADMIN", isActive: true },
        select: { id: true },
      });

      const pet = await prisma.pet.findUnique({
        where: { id: data.petId },
        select: { name: true },
      });

      const alertLabels: Record<string, string> = {
        NOT_EATING: "No está comiendo",
        LETHARGIC: "Está decaído",
        BEHAVIOR_ISSUE: "Problema de comportamiento",
        HEALTH_CONCERN: "Preocupación de salud",
        INCIDENT: "Incidente",
      };

      if (admins.length > 0) {
        await notifyUsers(prisma, admins.map((a) => a.id), {
          type: "STAFF_ALERT" as const,
          title: `🚨 Alerta: ${pet?.name ?? "Mascota"} - ${alertLabels[data.type]}`,
          body: data.description,
          data: {
            reservationId: data.reservationId,
            petId: data.petId,
            alertId: alert.id,
            alertType: data.type,
          },
        });
      }

      return reply.status(201).send(alert);
    }
  );

  // ─── PATCH /staff/alerts/:id/resolve — resolver alerta ─────────

  fastify.patch<{ Params: { id: string } }>(
    "/staff/alerts/:id/resolve",
    { preHandler },
    async (request, reply) => {
      const alert = await prisma.staffAlert.findUnique({
        where: { id: request.params.id },
      });

      if (!alert) {
        return reply.status(404).send({ error: "Alerta no encontrada" });
      }

      if (alert.isResolved) {
        return reply.status(400).send({ error: "La alerta ya fue resuelta" });
      }

      const updated = await prisma.staffAlert.update({
        where: { id: request.params.id },
        data: { isResolved: true, resolvedAt: new Date() },
      });

      return updated;
    }
  );

  // ─── PATCH /staff/addons/:id/complete — marcar baño como completado ─
  //  Requiere foto del perro bañado (mediaUrl). Crea StayUpdate.

  fastify.patch<{ Params: { id: string }; Body: { mediaUrl?: string } }>(
    "/staff/addons/:id/complete",
    { preHandler },
    async (request, reply) => {
      const mediaUrl = request.body?.mediaUrl;
      if (typeof mediaUrl !== "string" || !mediaUrl.startsWith("http")) {
        return reply.status(400).send({
          error: "Se requiere una foto del baño completado",
        });
      }

      const addon = await prisma.reservationAddon.findUnique({
        where: { id: request.params.id },
        include: {
          variant: { include: { serviceType: true } },
          reservation: { select: { id: true, petId: true, pet: { select: { name: true } } } },
        },
      });

      if (!addon) {
        return reply.status(404).send({ error: "Servicio no encontrado" });
      }

      if (addon.completedAt) {
        return reply.status(400).send({ error: "El servicio ya fue completado" });
      }

      const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.reservationAddon.update({
          where: { id: request.params.id },
          data: { completedAt: new Date() },
          include: { variant: { include: { serviceType: true } } },
        });
        await tx.stayUpdate.create({
          data: {
            reservationId: addon.reservation.id,
            petId: addon.reservation.petId,
            staffId: request.userId!,
            mediaUrl,
            mediaType: "image",
            caption: `${addon.reservation.pet.name} listo después del baño`,
          },
        });
        return result;
      });

      return updated;
    }
  );

  // ─── POST /staff/addons/:id/set-extras — definir precio extra ─
  //  Para deslanado/corte: el owner no pagó este precio al reservar
  //  (los servicios extras tienen costo variable según el estado del pelaje).
  //  Staff define el precio aquí; el owner lo verá como saldo a pagar.
  fastify.post<{
    Params: { id: string };
    Body: {
      // Nuevo desglose: cada extra se cotiza por separado.
      extraDeslanadoPrice?: number;
      extraCortePrice?: number;
    };
  }>(
    "/staff/addons/:id/set-extras",
    { preHandler },
    async (request, reply) => {
      const { extraDeslanadoPrice, extraCortePrice } = request.body;

      const validatePrice = (
        value: number | undefined,
        label: string,
      ): string | null => {
        if (value === undefined) return null;
        if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
          return `${label} debe ser un número mayor a 0`;
        }
        return null;
      };
      const desErr = validatePrice(extraDeslanadoPrice, "extraDeslanadoPrice");
      if (desErr) return reply.status(400).send({ error: desErr });
      const corErr = validatePrice(extraCortePrice, "extraCortePrice");
      if (corErr) return reply.status(400).send({ error: corErr });
      if (extraDeslanadoPrice === undefined && extraCortePrice === undefined) {
        return reply
          .status(400)
          .send({ error: "Se requiere al menos un precio (deslanado o corte)" });
      }

      const addon = await prisma.reservationAddon.findUnique({
        where: { id: request.params.id },
        include: {
          variant: { include: { serviceType: true } },
          reservation: {
            select: {
              id: true,
              ownerId: true,
              pet: { select: { name: true } },
            },
          },
        },
      });
      if (!addon) {
        return reply.status(404).send({ error: "Servicio no encontrado" });
      }
      if (addon.variant.serviceType.code !== "BATH") {
        return reply
          .status(400)
          .send({ error: "El precio extra solo aplica a servicios de baño" });
      }
      if (addon.extraPaidAt) {
        return reply
          .status(409)
          .send({ error: "El extra ya fue cobrado, no se puede modificar" });
      }

      // Validar que los precios enviados correspondan a extras realmente
      // contratados en la variante.
      if (extraDeslanadoPrice !== undefined && !addon.variant.deslanado) {
        return reply.status(400).send({
          error: "Este baño no incluye deslanado",
        });
      }
      if (extraCortePrice !== undefined && !addon.variant.corte) {
        return reply.status(400).send({
          error: "Este baño no incluye corte",
        });
      }

      // Conservar precios previos si no se reenvían en este request — permite
      // setear uno primero y luego el otro.
      const prevDes = addon.extraDeslanadoPrice
        ? Number(addon.extraDeslanadoPrice)
        : null;
      const prevCor = addon.extraCortePrice
        ? Number(addon.extraCortePrice)
        : null;
      const nextDes =
        extraDeslanadoPrice !== undefined ? extraDeslanadoPrice : prevDes;
      const nextCor =
        extraCortePrice !== undefined ? extraCortePrice : prevCor;

      // ¿Todos los extras aplicables tienen precio? Sólo entonces marcamos
      // PENDING_PAYMENT y notificamos al owner.
      const needsDes = addon.variant.deslanado;
      const needsCor = addon.variant.corte;
      const isComplete =
        (!needsDes || nextDes !== null) && (!needsCor || nextCor !== null);

      const parts: string[] = [];
      if (nextDes !== null && needsDes) {
        parts.push(`Deslanado $${nextDes.toLocaleString("es-MX")}`);
      }
      if (nextCor !== null && needsCor) {
        parts.push(`Corte $${nextCor.toLocaleString("es-MX")}`);
      }
      const description = parts.join(" · ") || "Extras";
      const total = (nextDes ?? 0) + (nextCor ?? 0);

      const updated = await prisma.reservationAddon.update({
        where: { id: request.params.id },
        data: {
          extraDeslanadoPrice:
            nextDes !== null ? new Prisma.Decimal(nextDes) : null,
          extraCortePrice:
            nextCor !== null ? new Prisma.Decimal(nextCor) : null,
          extraPrice: isComplete ? new Prisma.Decimal(total) : null,
          extraDescription: description,
          extraPaymentStatus: isComplete ? "PENDING_PAYMENT" : null,
          extraSetById: request.userId!,
          extraSetAt: new Date(),
        },
        include: { variant: { include: { serviceType: true } } },
      });

      // Solo notificar cuando el desglose esté completo (owner puede pagar).
      if (isComplete) {
        await notifyUser(prisma, {
          userId: addon.reservation.ownerId,
          type: "GENERAL",
          title: `Saldo del baño de ${addon.reservation.pet.name}`,
          body: `${description} (total $${total.toLocaleString("es-MX")}). Elige cómo pagarlo en la app.`,
          data: {
            reservationId: addon.reservation.id,
            addonId: addon.id,
            kind: "BATH_EXTRA_PRICED",
          },
        });

        const admins = await prisma.user.findMany({
          where: { role: "ADMIN", isActive: true },
          select: { id: true },
        });
        if (admins.length > 0) {
          await notifyUsers(
            prisma,
            admins.map((a) => a.id),
            {
              type: "GENERAL",
              title: "Extras de baño cotizados",
              body: `${addon.reservation.pet.name} — ${description} (total $${total.toLocaleString("es-MX")})`,
              data: {
                reservationId: addon.reservation.id,
                addonId: addon.id,
                kind: "BATH_EXTRA_PRICED",
              },
            },
          );
        }
      }

      return updated;
    },
  );

  // ─── POST /staff/addons/:id/confirm-pickup-paid — marcar como cobrado ─
  //  Cuando el owner eligió "Pagar al recoger", staff confirma aquí.
  //  Se captura el método (CASH/TRANSFER) y se genera el Payment record para
  //  que el cobro aparezca en la sección de Pagos del owner.
  fastify.post<{
    Params: { id: string };
    Body: { method?: "CASH" | "TRANSFER" };
  }>(
    "/staff/addons/:id/confirm-pickup-paid",
    { preHandler },
    async (request, reply) => {
      const method = request.body?.method ?? "CASH";
      if (!["CASH", "TRANSFER"].includes(method)) {
        return reply.status(400).send({ error: "Método inválido" });
      }
      const addon = await prisma.reservationAddon.findUnique({
        where: { id: request.params.id },
        include: {
          reservation: {
            select: { id: true, ownerId: true, pet: { select: { name: true } } },
          },
        },
      });
      if (!addon) {
        return reply.status(404).send({ error: "Servicio no encontrado" });
      }
      if (addon.extraPaymentStatus !== "PAY_ON_PICKUP") {
        return reply
          .status(400)
          .send({ error: "Este servicio no está en modo 'pagar al recoger'" });
      }

      const extraAmount = addon.extraPrice ? Number(addon.extraPrice) : 0;

      const updated = await prisma.$transaction(async (tx) => {
        const updatedAddon = await tx.reservationAddon.update({
          where: { id: request.params.id },
          data: {
            extraPaymentStatus: "PAID",
            extraPaidAt: new Date(),
          },
          include: { variant: { include: { serviceType: true } } },
        });
        if (extraAmount > 0.01) {
          await tx.payment.create({
            data: {
              amount: new Prisma.Decimal(extraAmount),
              method,
              status: "PAID",
              paidAt: new Date(),
              reservationId: addon.reservation.id,
              userId: addon.reservation.ownerId,
              notes: `Extras de baño (${method}) cobrado al recoger`,
            },
          });
        }
        return updatedAddon;
      });

      // Si era baño suelto y ya quedó todo saldado, concluirlo.
      await maybeConcludeStandaloneBath(prisma, addon.reservation.id);

      await notifyUser(prisma, {
        userId: addon.reservation.ownerId,
        type: "GENERAL",
        title: "Pago de extras confirmado",
        body: `Recibimos el pago de los extras del baño de ${addon.reservation.pet.name}. ¡Gracias!`,
        data: { reservationId: addon.reservation.id, kind: "BATH_EXTRA_PAID" },
      });

      return updated;
    },
  );

  // ─── POST /staff/behavior-tags — agregar etiqueta ─────────────

  fastify.post(
    "/staff/behavior-tags",
    { preHandler },
    async (request, reply) => {
      const parsed = CreateBehaviorTagSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const tag = await prisma.behaviorTag.create({
        data: {
          ...parsed.data,
          staffId: request.userId!,
        },
      });

      return reply.status(201).send(tag);
    }
  );

  // ─── GET /staff/behavior-tags/:petId — tags de mascota ────────

  fastify.get<{ Params: { petId: string } }>(
    "/staff/behavior-tags/:petId",
    { preHandler },
    async (request) => {
      const tags = await prisma.behaviorTag.findMany({
        where: { petId: request.params.petId },
        orderBy: { createdAt: "desc" },
        include: {
          staff: { select: { id: true, firstName: true, lastName: true } },
        },
      });

      return tags;
    }
  );

  // ─── DELETE /staff/behavior-tags/:tagId — quitar etiqueta ─────

  fastify.delete<{ Params: { tagId: string } }>(
    "/staff/behavior-tags/:tagId",
    { preHandler },
    async (request, reply) => {
      const existing = await prisma.behaviorTag.findUnique({
        where: { id: request.params.tagId },
      });
      if (!existing) {
        return reply.status(404).send({ error: "Etiqueta no encontrada" });
      }

      await prisma.behaviorTag.delete({
        where: { id: request.params.tagId },
      });

      return reply.status(200).send({ ok: true });
    }
  );
}
