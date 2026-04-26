import { FastifyInstance, FastifyRequest } from "fastify";
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
        type: "CHECKLIST_REMINDER" as any,
        createdAt: { gte: todayStart },
      },
    });
    if (existingReminder) return;

    const petNames = staysWithoutChecklist.map((s) => s.pet.name).join(", ");
    await notifyUser(prisma, {
      userId: staffId,
      type: "CHECKLIST_REMINDER" as any,
      title: "Reportes diarios pendientes 📋",
      body: `Faltan reportes de hoy para: ${petNames}. No olvides llenarlos.`,
      data: {
        reservationIds: staysWithoutChecklist.map((s) => s.id),
      },
    });
  }

  // ─── GET /staff/stays — estancias activas ─────────────────────

  fastify.get<{
    Querystring: { status?: string };
  }>("/staff/stays", { preHandler }, async (request) => {
    const status = request.query.status || "CHECKED_IN";
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // Send checklist reminders (non-blocking, once per day)
    if (status === "CHECKED_IN" && request.userId) {
      sendChecklistReminders(request.userId).catch(() => {});
    }

    const stays = await prisma.reservation.findMany({
      where: {
        reservationType: "STAY",
        status: status as any,
        ...(request.userRole === "STAFF" ? { staffId: request.userId } : {}),
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
        },
      });

      if (!stay) {
        return reply.status(404).send({ error: "Estancia no encontrada" });
      }

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

      // Notificación al staff asignado
      await notifyUser(prisma, {
        userId: request.userId!,
        type: "STAFF_ASSIGNED" as any,
        title: `Te asignaste a ${updated.pet.name}`,
        body: `Ahora eres responsable de la estancia de ${updated.pet.name}. Revisa los detalles y prepárate para el check-in.`,
        data: { reservationId: id },
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

      const updated = await prisma.reservation.update({
        where: { id },
        data: { status: "CHECKED_OUT" },
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

  // ─── POST /staff/checklists — crear reporte diario ────────────

  fastify.post(
    "/staff/checklists",
    { preHandler },
    async (request, reply) => {
      const body = request.body as Record<string, unknown> | null;
      const mediaUrl = body?.mediaUrl;
      if (typeof mediaUrl !== "string" || !mediaUrl.startsWith("http")) {
        return reply.status(400).send({
          error: "Se requiere una foto del día para guardar el reporte",
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

      const checklist = await prisma.$transaction(async (tx) => {
        await tx.stayUpdate.create({
          data: {
            reservationId: data.reservationId,
            petId: reservation.pet.id,
            staffId: request.userId!,
            mediaUrl,
            mediaType: "image",
            caption: data.additionalNotes ?? null,
          },
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
      const tail = ownerNote.length > 0
        ? `${ownerNote} Hay foto nueva 📸`
        : "Sube a la app para ver la foto del día 📸";

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

      // Notificación al dueño de nueva evidencia
      const pet = await prisma.pet.findUnique({
        where: { id: data.petId },
        select: { name: true },
      });

      await notifyUser(prisma, {
        userId: reservation.ownerId,
        type: "NEW_UPDATE",
        title: `Nueva ${data.mediaType === "video" ? "video" : "foto"} de ${pet?.name ?? "tu mascota"}`,
        body: data.caption || `Se ha subido una nueva ${data.mediaType === "video" ? "video" : "foto"} de la estancia.`,
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
