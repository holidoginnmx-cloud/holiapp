import { z } from "zod";

// ========================
// Enums
// ========================

export const RoleEnum = z.enum(["OWNER", "STAFF", "ADMIN"]);
export type Role = z.infer<typeof RoleEnum>;

export const PetSizeEnum = z.enum(["XS", "S", "M", "L", "XL"]);
export type PetSize = z.infer<typeof PetSizeEnum>;

export const CartillaStatusEnum = z.enum(["PENDING", "APPROVED", "REJECTED", "EXPIRED"]);
export type CartillaStatus = z.infer<typeof CartillaStatusEnum>;

export const ReservationStatusEnum = z.enum([
  "CONFIRMED",
  "CHECKED_IN",
  "CHECKED_OUT",
  "CANCELLED",
]);
export type ReservationStatus = z.infer<typeof ReservationStatusEnum>;

export const PaymentStatusEnum = z.enum([
  "UNPAID",
  "PARTIAL",
  "PAID",
  "REFUNDED",
]);
export type PaymentStatus = z.infer<typeof PaymentStatusEnum>;

export const PaymentMethodEnum = z.enum(["CASH", "CARD", "TRANSFER", "STRIPE"]);
export type PaymentMethod = z.infer<typeof PaymentMethodEnum>;

export const NotificationTypeEnum = z.enum([
  "RESERVATION_CONFIRMED",
  "RESERVATION_REMINDER",
  "CHECK_IN",
  "CHECK_OUT",
  "NEW_UPDATE",
  "PAYMENT_RECEIVED",
  "GENERAL",
  "DAILY_REPORT",
  "STAFF_ALERT",
  "REVIEW_REQUEST",
  "RESERVATION_CHANGE_REQUESTED",
  "RESERVATION_CHANGE_APPROVED",
  "RESERVATION_CHANGE_REJECTED",
  "REFUND_ISSUED",
  "CREDIT_ADDED",
  "CREDIT_APPLIED",
  "NEW_RESERVATION",
  "STAFF_ASSIGNED",
  "CHECKLIST_REMINDER",
  "VACCINE_EXPIRING",
]);

export const RefundChoiceEnum = z.enum(["STRIPE_REFUND", "CREDIT"]);
export type RefundChoice = z.infer<typeof RefundChoiceEnum>;

export const ChangeRequestStatusEnum = z.enum([
  "PENDING",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
]);
export type ChangeRequestStatus = z.infer<typeof ChangeRequestStatusEnum>;

export const CreditEntryTypeEnum = z.enum([
  "CREDIT_ADDED",
  "CREDIT_APPLIED",
  "CREDIT_ADJUSTED",
]);
export type CreditEntryType = z.infer<typeof CreditEntryTypeEnum>;

export const CreateChangeRequestSchema = z.object({
  newCheckIn: z.coerce.date(),
  newCheckOut: z.coerce.date(),
  refundChoice: RefundChoiceEnum.optional().nullable(),
});
export type CreateChangeRequest = z.infer<typeof CreateChangeRequestSchema>;

export const CancelReservationSchema = z.object({
  refundChoice: RefundChoiceEnum,
});
export type CancelReservation = z.infer<typeof CancelReservationSchema>;

export const RejectChangeRequestSchema = z.object({
  reason: z.string().min(1).max(500),
});
export type RejectChangeRequest = z.infer<typeof RejectChangeRequestSchema>;
export type NotificationType = z.infer<typeof NotificationTypeEnum>;

export const EnergyLevelEnum = z.enum(["LOW", "MEDIUM", "HIGH"]);
export type EnergyLevel = z.infer<typeof EnergyLevelEnum>;

export const SocializationLevelEnum = z.enum(["ISOLATED", "SELECTIVE", "SOCIAL"]);
export type SocializationLevel = z.infer<typeof SocializationLevelEnum>;

export const RestQualityEnum = z.enum(["POOR", "FAIR", "GOOD"]);
export type RestQuality = z.infer<typeof RestQualityEnum>;

export const MoodLevelEnum = z.enum(["SAD", "NEUTRAL", "HAPPY", "EXCITED"]);
export type MoodLevel = z.infer<typeof MoodLevelEnum>;

export const BehaviorTagValueEnum = z.enum(["CALM", "ANXIOUS", "DOMINANT", "SOCIABLE", "SHY", "AGGRESSIVE"]);
export type BehaviorTagValue = z.infer<typeof BehaviorTagValueEnum>;

export const AlertTypeEnum = z.enum(["NOT_EATING", "LETHARGIC", "BEHAVIOR_ISSUE", "HEALTH_CONCERN", "INCIDENT"]);
export type AlertType = z.infer<typeof AlertTypeEnum>;

// ========================
// User
// ========================

export const UserSchema = z.object({
  id: z.string().cuid(),
  clerkId: z.string().nullable(),
  email: z.string().email(),
  phone: z.string().nullable(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  avatarUrl: z.string().url().nullable(),
  role: RoleEnum,
  isActive: z.boolean(),
  // Saldo a favor del cliente (Decimal en BD → llega como string/number en JSON).
  creditBalance: z.coerce.number().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const CreateUserSchema = UserSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  clerkId: z.string().optional(),
  phone: z.string().nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
  role: RoleEnum.default("OWNER"),
  isActive: z.boolean().default(true),
});

export const UpdateUserSchema = CreateUserSchema.partial();

export type User = z.infer<typeof UserSchema>;
export type CreateUser = z.infer<typeof CreateUserSchema>;

// ========================
// Pet
// ========================

export const PetSchema = z.object({
  id: z.string().cuid(),
  // `.trim()` no es cosmético: los candados anti-duplicado comparan por nombre,
  // y un "Dugan " con espacio final se escapaba de todos ellos creando una
  // segunda ficha del mismo perro (pasó en prod el 26-ago-2026).
  name: z.string().trim().min(1),
  breed: z.string().nullable(),
  size: PetSizeEnum,
  birthDate: z.coerce.date().nullable(),
  weight: z.number().positive().nullable(),
  photoUrl: z.string().url().nullable(),
  notes: z.string().nullable(),
  sex: z.string().nullable(),
  behavior: z.string().nullable(),
  walkPreference: z.string().nullable(),
  healthIssues: z.string().nullable(),
  isNeutered: z.boolean(),
  emergencyContactName: z.string().nullable(),
  emergencyContactPhone: z.string().nullable(),
  emergencyContactRelation: z.string().nullable(),
  vetName: z.string().nullable(),
  vetPhone: z.string().nullable(),
  vetEmergency24h: z.boolean(),
  feedingSchedule: z.string().nullable(),
  feedingAmount: z.string().nullable(),
  foodType: z.string().nullable(),
  feedingInstructions: z.string().nullable(),
  diet: z.string().nullable(),
  personality: z.string().nullable(),
  /**
   * Minutos que tarda el baño de ESTE perro, sin extras. Excepción a la tabla
   * por talla; null = sigue la regla general. Solo staff/admin lo escriben.
   */
  groomingMinutes: z.number().int().min(15).max(600).nullable(),
  /** @deprecated usar `cartillaPhotos`; queda por compatibilidad. */
  cartillaUrl: z.string().nullable(),
  cartillaPhotos: z.array(z.string()).default([]),
  cartillaStatus: CartillaStatusEnum.nullable(),
  cartillaReviewedAt: z.coerce.date().nullable(),
  cartillaReviewedById: z.string().nullable(),
  cartillaRejectionReason: z.string().nullable(),
  cartillaApprovalNote: z.string().nullable(),
  isActive: z.boolean(),
  ownerId: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const CreatePetSchema = PetSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  cartillaStatus: true,           // gestionado por servidor/admin
  cartillaReviewedAt: true,
  cartillaReviewedById: true,
  cartillaRejectionReason: true,
  cartillaApprovalNote: true,
}).extend({
  isActive: z.boolean().default(true),
  // El dueño se deriva del usuario autenticado en el servidor; el cliente
  // puede omitirlo o mandarlo null (p.ej. si su userId aún no sincronizó).
  // Solo ADMIN puede crear para otro dueño pasando un ownerId explícito.
  ownerId: z.string().nullish(),
  sex: z.string().nullable().default(null),
  behavior: z.string().nullable().default(null),
  walkPreference: z.string().nullable().default(null),
  healthIssues: z.string().nullable().default(null),
  isNeutered: z.boolean().default(false),
  emergencyContactName: z.string().nullable().default(null),
  emergencyContactPhone: z.string().nullable().default(null),
  emergencyContactRelation: z.string().nullable().default(null),
  vetName: z.string().nullable().default(null),
  vetPhone: z.string().nullable().default(null),
  vetEmergency24h: z.boolean().default(false),
  feedingSchedule: z.string().nullable().default(null),
  feedingAmount: z.string().nullable().default(null),
  foodType: z.string().nullable().default(null),
  feedingInstructions: z.string().nullable().default(null),
  diet: z.string().nullable().default(null),
  personality: z.string().nullable().default(null),
  groomingMinutes: z.number().int().min(15).max(600).nullable().default(null),
  /** @deprecated usar `cartillaPhotos`. */
  cartillaUrl: z.string().nullable().default(null),
  cartillaPhotos: z.array(z.string()).default([]),
});

export const UpdatePetSchema = CreatePetSchema.partial().omit({ ownerId: true });

export const VaccineEntrySchema = z.object({
  // Opcional: el tipo casi nunca es visible en la cartilla; basta con la fecha.
  catalogId: z.string().cuid().optional(),
  appliedAt: z.coerce.date(),
  expiresAt: z.coerce.date(),
  vetName: z.string().max(120).optional(),
});
export type VaccineEntry = z.infer<typeof VaccineEntrySchema>;

export const UpdateVaccineSchema = z.object({
  catalogId: z.string().cuid().optional(),
  appliedAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional(),
  vetName: z.string().max(120).nullable().optional(),
});
export type UpdateVaccine = z.infer<typeof UpdateVaccineSchema>;

export const DewormingEntrySchema = z.object({
  type: z.enum(["INTERNAL", "EXTERNAL", "BOTH"]),
  productName: z.string().max(120).nullable().optional(),
  appliedAt: z.coerce.date(),
  expiresAt: z.coerce.date().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});
export type DewormingEntry = z.infer<typeof DewormingEntrySchema>;

export const ReviewCartillaSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("APPROVE"),
    vaccines: z.array(VaccineEntrySchema).optional(),
    dewormings: z.array(DewormingEntrySchema).optional(),
    // Observación opcional para el cliente; viaja en la notificación de
    // aprobación y se persiste en Pet.cartillaApprovalNote.
    note: z.string().max(500).optional(),
  }),
  z.object({
    action: z.literal("REJECT"),
    reason: z.string().max(500).optional(),
  }),
]);
export type ReviewCartilla = z.infer<typeof ReviewCartillaSchema>;

export type Pet = z.infer<typeof PetSchema>;
export type CreatePet = z.infer<typeof CreatePetSchema>;

// ========================
// Vaccine
// ========================

export const VaccineSchema = z.object({
  id: z.string().cuid(),
  name: z.string().min(1),
  appliedAt: z.coerce.date(),
  expiresAt: z.coerce.date().nullable(),
  vetName: z.string().nullable(),
  fileUrl: z.string().nullable(),
  catalogId: z.string().cuid().nullable(),
  petId: z.string(),
  createdAt: z.coerce.date(),
});

export const CreateVaccineSchema = VaccineSchema.omit({
  id: true,
  petId: true,
  createdAt: true,
}).extend({
  // catalogId is required for new vaccines (was nullable in storage only for legacy rows).
  catalogId: z.string().cuid(),
});

export type Vaccine = z.infer<typeof VaccineSchema>;
export type CreateVaccine = z.infer<typeof CreateVaccineSchema>;

// ========================
// Deworming
// ========================

export const DewormingTypeEnum = z.enum(["INTERNAL", "EXTERNAL", "BOTH"]);
export type DewormingTypeValue = z.infer<typeof DewormingTypeEnum>;

export const DewormingSchema = z.object({
  id: z.string().cuid(),
  type: DewormingTypeEnum,
  productName: z.string().nullable(),
  appliedAt: z.coerce.date(),
  expiresAt: z.coerce.date().nullable(),
  vetName: z.string().nullable(),
  fileUrl: z.string().nullable(),
  notes: z.string().nullable(),
  petId: z.string(),
  createdAt: z.coerce.date(),
});

export const CreateDewormingSchema = DewormingSchema.omit({
  id: true,
  petId: true,
  createdAt: true,
}).extend({
  productName: z.string().max(120).nullable().default(null),
  vetName: z.string().max(120).nullable().default(null),
  fileUrl: z.string().url().nullable().default(null),
  notes: z.string().max(500).nullable().default(null),
  expiresAt: z.coerce.date().nullable().default(null),
});

export type Deworming = z.infer<typeof DewormingSchema>;
export type CreateDeworming = z.infer<typeof CreateDewormingSchema>;

// ========================
// VaccineCatalog
// ========================

export const VaccineCatalogSchema = z.object({
  id: z.string().cuid(),
  code: z.string(),
  displayName: z.string(),
  defaultDurationDays: z.number().int().positive(),
  description: z.string().nullable(),
  isActive: z.boolean(),
});
export type VaccineCatalog = z.infer<typeof VaccineCatalogSchema>;

// ========================
// Room
// ========================

export const RoomSchema = z.object({
  id: z.string().cuid(),
  name: z.string().min(1),
  description: z.string().nullable(),
  capacity: z.number().int().positive(),
  sizeAllowed: z.array(PetSizeEnum),
  isActive: z.boolean(),
  photoUrl: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const CreateRoomSchema = RoomSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  isActive: z.boolean().default(true),
  photoUrl: z.string().nullable().optional(),
});

export const UpdateRoomSchema = CreateRoomSchema.partial();

export type Room = z.infer<typeof RoomSchema>;
export type CreateRoom = z.infer<typeof CreateRoomSchema>;

// ========================
// Reservation
// ========================

/**
 * Viajes que cubre la tarifa del domicilio. Default PICKUP: es lo que se cobró
 * siempre y lo que sigue mandando cualquier cliente viejo de la app.
 */
export const DeliveryTripSchema = z.enum(["PICKUP", "DROPOFF", "ROUND_TRIP"]);
export type DeliveryTrip = z.infer<typeof DeliveryTripSchema>;

export const ReservationSchema = z.object({
  id: z.string().cuid(),
  reservationType: z.enum(["STAY", "BATH", "DAYCARE"]).default("STAY"),
  checkIn: z.coerce.date().nullable(),
  checkOut: z.coerce.date().nullable(),
  appointmentAt: z.coerce.date().nullable(),
  status: ReservationStatusEnum,
  totalDays: z.number().int().positive().nullable(),
  totalAmount: z.number().nonnegative(),
  notes: z.string().nullable(),
  // Nota del equipo. Opcional porque la API la BORRA de la respuesta cuando
  // quien pregunta es el dueño (ver lib/stripInternal.ts): en el payload del
  // cliente el campo no viene.
  internalNotes: z.string().nullable().optional(),
  // Instrucciones de medicamento (existe en la BD; staff la captura por estancia).
  medicationNotes: z.string().nullable().optional(),
  legalAccepted: z.boolean(),
  groupId: z.string().nullable(),
  // Hora estimada elegida por el cliente ("HH:mm", hora local del hotel).
  checkInTime: z.string().nullable().optional(),
  checkOutTime: z.string().nullable().optional(),
  paymentType: z.string().nullable(),
  depositDeadline: z.coerce.date().nullable(),
  // Servicio a domicilio. Opcionales por compatibilidad con payloads viejos.
  // `homeDeliveryFee` es Decimal en la BD y Fastify lo serializa como STRING:
  // conviértelo con Number() antes de sumarlo.
  homeDelivery: z.boolean().optional(),
  homeDeliveryAddress: z.string().nullable().optional(),
  homeDeliveryDistanceKm: z.number().nullable().optional(),
  homeDeliveryFee: z.union([z.string(), z.number()]).nullable().optional(),
  // Qué viajes cubre la tarifa. Los registros anteriores a la columna son
  // traslados sencillos, y así los devuelve la BD (default PICKUP).
  homeDeliveryTrip: DeliveryTripSchema.optional(),
  // Desglose del precio ORIGINAL de una estancia (Decimal → string, como la
  // fee de domicilio). NULL/ausente en reservas viejas, otros tipos o total
  // manual: sin datos, el desglose no se muestra.
  lodgingAmount: z.union([z.string(), z.number()]).nullable().optional(),
  medicationFee: z.union([z.string(), z.number()]).nullable().optional(),
  sameDayFee: z.union([z.string(), z.number()]).nullable().optional(),
  // Descuento aplicado al reservar (código compartido con la tienda).
  discountTotal: z.union([z.string(), z.number()]).nullable().optional(),
  ownerId: z.string(),
  petId: z.string(),
  roomId: z.string().nullable(),
  staffId: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const BathSelectionSchema = z.object({
  deslanado: z.boolean(),
  corte: z.boolean(),
});
export type BathSelection = z.infer<typeof BathSelectionSchema>;

export const MedicationSelectionSchema = z.object({
  notes: z.string().min(1),
});
export type MedicationSelection = z.infer<typeof MedicationSelectionSchema>;

// Servicio a domicilio: el cliente solo manda la dirección + coordenadas
// (de Google Places vía nuestro proxy). distanceKm/fee son opcionales y SOLO
// informativos — el backend SIEMPRE recalcula la tarifa server-side desde
// lat/lng (nunca confía en el cliente para el cobro).
export const HomeDeliveryInputSchema = z.object({
  address: z.string().min(1),
  lat: z.number(),
  lng: z.number(),
  placeId: z.string().optional(),
  distanceKm: z.number().optional(),
  fee: z.number().optional(),
  trip: DeliveryTripSchema.optional(),
});
export type HomeDeliveryInput = z.infer<typeof HomeDeliveryInputSchema>;

// Agregar / cambiar / quitar el domicilio de una reserva YA creada (el dueño o
// el equipo). Hasta ahora solo se podía capturar al crear: si el cliente lo
// pedía después, había que cancelar y volver a reservar.
//
// `enable: true` sobre una reserva que ya lo tiene REEMPLAZA la dirección (un
// solo paso, un solo aviso). La tarifa la recotiza siempre el servidor.
export const UpdateReservationDeliverySchema = z.discriminatedUnion("enable", [
  z.object({
    enable: z.literal(true),
    address: z.string().min(1),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    placeId: z.string().optional(),
    trip: DeliveryTripSchema.optional(),
    // Cortesía: el viaje se hace igual pero no se cobra (tarifa 0). Solo el
    // equipo puede regalarlo; la API ignora esta bandera si la manda el dueño.
    isCourtesy: z.boolean().optional(),
  }),
  z.object({ enable: z.literal(false) }),
]);
export type UpdateReservationDelivery = z.infer<typeof UpdateReservationDeliverySchema>;

// Hora local del hotel en formato 24h "HH:mm" (p.ej. "09:30", "17:00").
export const TimeHHmmSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida (formato HH:mm)");

export const CreateReservationSchema = z.object({
  reservationType: z.enum(["STAY", "BATH", "DAYCARE"]).default("STAY"),
  // Nota del CLIENTE (la ve él en su app).
  notes: z.string().nullable().default(null),
  // Nota del EQUIPO. Es la que captura el wizard del admin: antes escribía en
  // `notes` con el placeholder "Notas internas...", y el dueño la leía.
  internalNotes: z.string().nullable().optional(),
  legalAccepted: z.boolean(),
  ownerId: z.string(),
  // Una mascota (flujo clásico) o varias (multi-perro desde admin: se crea
  // UNA reserva por mascota con groupId compartido). Al menos uno es
  // requerido; se valida en la ruta.
  petId: z.string().optional(),
  petIds: z.array(z.string()).min(1).optional(),
  // STAY
  checkIn: z.coerce.date().optional(),
  checkOut: z.coerce.date().optional(),
  roomId: z.string().optional(),
  // Multi-perro: un cuarto por mascota, en el MISMO orden que petIds (los
  // perros de un grupo no siempre caben juntos ni comparten talla). Si se
  // omite, todas las filas van al `roomId` único de arriba.
  roomIds: z.array(z.string()).min(1).optional(),
  // Baño como complemento de un hospedaje (STAY). En BATH se usan los campos
  // deslanado/corte de nivel superior.
  bath: BathSelectionSchema.optional(),
  // BATH (cita puntual; el precio se resuelve server-side desde la variante)
  // DAYCARE: appointmentAt = día de la guardería (se ancla a mediodía UTC).
  appointmentAt: z.coerce.date().optional(),
  deslanado: z.boolean().optional(),
  corte: z.boolean().optional(),
  // Entrada/salida estimadas. En DAYCARE son obligatorias y definen el precio
  // (horas × tarifa única); en STAY son opcionales, sólo informativas.
  checkInTime: TimeHHmmSchema.optional(),
  checkOutTime: TimeHHmmSchema.optional(),
  // Total pactado manualmente (solo STAFF/ADMIN, cualquier tipo de servicio).
  // Con varias mascotas es el total del GRUPO: se reparte entre las filas.
  // El fee de domicilio siempre se suma aparte server-side.
  totalAmountOverride: z.number().nonnegative().optional(),
  // "Agendar de todos modos" (solo STAFF/ADMIN, solo BATH): guarda la cita
  // aunque se encime o termine después de que sale la estilista. Queda marcada
  // en la reserva para poder distinguirla en la agenda.
  scheduleOverride: z.boolean().optional(),
  // Campos adicionales (creación manual desde admin)
  staffId: z.string().optional(),
  medicationNotes: z.string().nullable().optional(),
  depositAgreed: z.number().nonnegative().optional(),
  homeDelivery: HomeDeliveryInputSchema.optional(),
  // Cotización de la que salió esta reserva. Solo cierra el círculo (la marca
  // CONVERTED y la enlaza); NO cambia nada del cálculo ni de la validación —
  // el precio prometido viaja, como cualquier otro, en totalAmountOverride.
  quoteId: z.string().optional(),
});

export const CreateMultiReservationSchema = z.object({
  checkIn: z.coerce.date(),
  checkOut: z.coerce.date(),
  // Hora estimada de llegada/recogida (opcional al reservar).
  checkInTime: TimeHHmmSchema.optional(),
  checkOutTime: TimeHHmmSchema.optional(),
  notes: z.string().nullable().default(null),
  legalAccepted: z.boolean(),
  ownerId: z.string(),
  petIds: z.array(z.string()).min(1),
  roomPreference: z.enum(["shared", "separate"]),
  // Null when saldo a favor covered the entire deposit/total and no Stripe
  // charge was created.
  stripePaymentIntentId: z.string().nullable(),
  paymentType: z.enum(["FULL", "DEPOSIT"]).default("FULL"),
  bathSelectionsByPet: z.record(z.string(), BathSelectionSchema).optional(),
  medicationByPet: z.record(z.string(), MedicationSelectionSchema).optional(),
  homeDelivery: HomeDeliveryInputSchema.optional(),
  // Solo se usa en la ruta credit-only (sin PaymentIntent): el servidor re-valida
  // el código. En el flujo Stripe el descuento se lee del metadata del PI.
  discountCode: z.string().max(40).optional(),
});

export const UpdateReservationStatusSchema = z.object({
  status: ReservationStatusEnum,
});

// Hora estimada de llegada/recogida: el dueño (o staff/admin) la puede
// indicar o cambiar después de reservar; null la borra.
export const UpdateReservationTimesSchema = z
  .object({
    checkInTime: TimeHHmmSchema.nullable().optional(),
    checkOutTime: TimeHHmmSchema.nullable().optional(),
  })
  .refine(
    (d) => d.checkInTime !== undefined || d.checkOutTime !== undefined,
    { message: "Indica al menos una hora" },
  );

// ── Horario de una guardería YA creada (STAFF/ADMIN) ─────────────────────────
// En guardería las horas SON el precio (horas × tarifa), así que mover el
// horario no es lo mismo que indicar una hora estimada de llegada: por eso
// tiene su propio contrato y no reusa UpdateReservationTimesSchema.
export const UpdateDaycareScheduleSchema = z.object({
  /** Día nuevo ("YYYY-MM-DD", fecha local del hotel). Ausente = no se mueve. */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (YYYY-MM-DD)")
    .optional(),
  checkInTime: TimeHHmmSchema,
  checkOutTime: TimeHHmmSchema,
  /** Ajustar el total por la diferencia de horas. false = precio pactado. */
  updateTotal: z.boolean().default(true),
  /** Guardar aunque el día ya pasó o el cupo esté lleno. */
  force: z.boolean().optional(),
});

// ── Edición de una reserva YA creada (solo ADMIN) ────────────────────────────
// Hasta ahora no había forma de corregir el precio ni las notas después de
// crear: si se capturaba sin el descuento, quedaba mal para siempre.

export const AdminUpdateReservationSchema = z
  .object({
    // Total NETO de la reserva, tal como se guarda en la columna. OJO: para
    // baños la UI muestra `totalAmount + extras del staff`; aquí va SOLO la
    // columna, o los extras se irían acumulando dentro de ella.
    totalAmount: z.number().nonnegative().optional(),
    // Nota del equipo. Nunca sale hacia el dueño.
    internalNotes: z.string().max(2000).nullable().optional(),
    // Nota del cliente (la que escribió al reservar); el admin puede corregirla.
    notes: z.string().max(2000).nullable().optional(),
    depositAgreed: z.number().nonnegative().nullable().optional(),
    // Queda en el aviso al equipo: "bajó $200 — descuento olvidado".
    priceChangeReason: z.string().max(200).optional(),
  })
  .refine(
    (d) =>
      d.totalAmount !== undefined ||
      d.internalNotes !== undefined ||
      d.notes !== undefined ||
      d.depositAgreed !== undefined,
    { message: "Indica al menos un campo a actualizar" }
  );

export const AdminCreateAddonSchema = z.object({
  variantId: z.string(),
  quantity: z.number().int().positive().optional(),
  // El precio lo manda el servidor desde el catálogo; esto solo lo pisa cuando
  // se pactó otro monto. Ignorado si `isCourtesy`.
  unitPriceOverride: z.number().nonnegative().optional(),
  isCourtesy: z.boolean().default(false),
  courtesyReason: z.string().max(200).optional(),
  internalNote: z.string().max(500).nullable().optional(),
  scheduledAt: z.coerce.date().optional(),
  // false = el servicio se cobrará aparte (addon STANDALONE) y no se suma al
  // total de la reserva. Irrelevante en cortesía, que nunca suma.
  addToTotal: z.boolean().default(true),
});

export const AdminUpdateAddonSchema = z
  .object({
    internalNote: z.string().max(500).nullable().optional(),
    isCourtesy: z.boolean().optional(),
    courtesyReason: z.string().max(200).nullable().optional(),
    unitPrice: z.number().nonnegative().optional(),
    scheduledAt: z.coerce.date().nullable().optional(),
  })
  .refine(
    (d) =>
      d.internalNote !== undefined ||
      d.isCourtesy !== undefined ||
      d.courtesyReason !== undefined ||
      d.unitPrice !== undefined ||
      d.scheduledAt !== undefined,
    { message: "Indica al menos un campo a actualizar" }
  );

export type AdminUpdateReservation = z.infer<typeof AdminUpdateReservationSchema>;
export type AdminCreateAddon = z.infer<typeof AdminCreateAddonSchema>;
export type AdminUpdateAddon = z.infer<typeof AdminUpdateAddonSchema>;

// ── Reagendar una cita de baño YA creada (STAFF/ADMIN) ───────────────────────
// Solo mueve la hora: el servicio, el precio y el grupo no cambian.
export const UpdateBathAppointmentSchema = z.object({
  appointmentAt: z.coerce.date(),
  // "Agendar de todos modos": guarda aunque se encime o esté en el pasado.
  force: z.boolean().optional(),
  overrideReason: z.string().max(300).optional(),
});
export type UpdateBathAppointment = z.infer<typeof UpdateBathAppointmentSchema>;

export type Reservation = z.infer<typeof ReservationSchema>;
export type CreateReservation = z.infer<typeof CreateReservationSchema>;
export type CreateMultiReservation = z.infer<typeof CreateMultiReservationSchema>;

// ========================
// Guest (invitado web) — reservas sin login desde la tienda Next.js.
// Schemas SEPARADOS de los de móvil: los endpoints /guest/* aceptan los datos
// completos de la mascota en línea + contacto del invitado, y el servidor
// auto-crea/reusa el User por email. La cartilla entra como PENDING (revisada
// por el admin antes del check-in). NO se tocan los schemas/endpoints de móvil.
// ========================

// Datos de mascota del invitado = CreatePet sin ownerId (lo deriva el servidor).
export const GuestPetSchema = CreatePetSchema.omit({ ownerId: true });
export type GuestPet = z.infer<typeof GuestPetSchema>;

export const GuestContactSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1).max(80),
  lastName: z.string().max(80).default(""),
  phone: z.string().max(40).nullable().optional(),
});
export type GuestContact = z.infer<typeof GuestContactSchema>;

// Consentimiento legal del invitado (checkboxes del wizard). El servidor
// registra las aceptaciones requeridas a nombre del User auto-creado.
export const GuestLegalSchema = z.object({
  accepted: z.literal(true),
});

export const GuestReservationIntentSchema = z.object({
  source: z.literal("web"),
  guest: GuestContactSchema,
  // Una o más mascotas inline (los add-ons se referencian por índice).
  pets: z.array(GuestPetSchema).min(1).max(6),
  checkIn: z.string().datetime(),
  checkOut: z.string().datetime(),
  roomPreference: z.enum(["shared", "separate"]),
  paymentType: z.enum(["FULL", "DEPOSIT"]).default("FULL"),
  // Add-ons keyed por ÍNDICE de la mascota en `pets` (aún no hay petId).
  bathSelectionsByIndex: z.record(z.string(), BathSelectionSchema).optional(),
  medicationByIndex: z
    .record(z.string(), z.object({ notes: z.string().min(1).max(450) }))
    .optional(),
  homeDelivery: HomeDeliveryInputSchema.optional(),
  legal: GuestLegalSchema,
});
export type GuestReservationIntent = z.infer<typeof GuestReservationIntentSchema>;

export const GuestReservationConfirmSchema = z.object({
  paymentIntentId: z.string(),
});

export const GuestBathIntentSchema = z.object({
  source: z.literal("web"),
  guest: GuestContactSchema,
  pet: GuestPetSchema,
  deslanado: z.boolean(),
  corte: z.boolean(),
  appointmentAt: z.string().datetime(),
  paymentType: z.enum(["DEPOSIT", "FULL"]).default("DEPOSIT"),
  notes: z.string().max(450).optional(),
  homeDelivery: HomeDeliveryInputSchema.optional(),
  legal: GuestLegalSchema,
});
export type GuestBathIntent = z.infer<typeof GuestBathIntentSchema>;

export const GuestBathConfirmSchema = z.object({
  paymentIntentId: z.string(),
});

export const GuestDaycareIntentSchema = z.object({
  source: z.literal("web"),
  guest: GuestContactSchema,
  // Una o más mascotas inline (cartilla PENDING; sin requisito de aprobación).
  pets: z.array(GuestPetSchema).min(1).max(6),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (YYYY-MM-DD)"),
  checkInTime: TimeHHmmSchema,
  checkOutTime: TimeHHmmSchema,
  notes: z.string().max(500).optional(),
  homeDelivery: HomeDeliveryInputSchema.optional(),
  legal: GuestLegalSchema,
});
export type GuestDaycareIntent = z.infer<typeof GuestDaycareIntentSchema>;

export const GuestDaycareConfirmSchema = z.object({
  paymentIntentId: z.string(),
});

// ========================
// Payment
// ========================

export const PaymentSchema = z.object({
  id: z.string().cuid(),
  amount: z.number().positive(),
  method: PaymentMethodEnum,
  status: PaymentStatusEnum,
  reference: z.string().nullable(),
  stripePaymentIntentId: z.string().nullable(),
  // Comisión que Stripe descuenta (solo pagos STRIPE). `amount` SIEMPRE es
  // bruto: el neto que entra al negocio es amount − stripeFeeAmount.
  stripeFeeAmount: z.coerce.number().nullable().optional(),
  // Cuándo Stripe libera el dinero para el depósito automático (≈ cuándo cae
  // al banco). Si el depósito real ya se concilió, manda payoutLines.
  stripeAvailableOn: z.coerce.date().nullable().optional(),
  paidAt: z.coerce.date().nullable(),
  notes: z.string().nullable(),
  // Un pago cuelga de una reserva O de un pedido de tienda, nunca de los dos.
  // `reservationId` es null en las ventas de tienda (mostrador y en línea).
  reservationId: z.string().nullable(),
  orderId: z.string().nullable().optional(),
  userId: z.string(),
  createdAt: z.coerce.date(),
  // Presente solo donde la API incluye la relación (detalle de reservación):
  // el depósito de Stripe ya conciliado al que pertenece este pago.
  payoutLines: z
    .array(
      z.object({
        payout: z.object({
          arrivalDate: z.coerce.date(),
          status: z.string(),
        }),
      }),
    )
    .optional(),
});

export const CreatePaymentSchema = PaymentSchema.omit({
  id: true,
  createdAt: true,
  // Solo lectura: los escribe el webhook de Stripe / la conciliación de
  // depósitos, nunca el que registra un pago.
  stripeFeeAmount: true,
  stripeAvailableOn: true,
  payoutLines: true,
})
  .extend({
    status: PaymentStatusEnum.default("PAID"),
    paidAt: z.coerce.date().default(() => new Date()),
  })
  .refine((d) => (d.reservationId != null) !== (d.orderId != null), {
    message: "Un pago pertenece a una reservación o a un pedido, no a ambos",
    path: ["reservationId"],
  });

export type Payment = z.infer<typeof PaymentSchema>;
export type CreatePayment = z.infer<typeof CreatePaymentSchema>;

// ========================
// StayUpdate
// ========================

export const StayUpdateSchema = z.object({
  id: z.string().cuid(),
  caption: z.string().nullable(),
  mediaUrl: z.string(),
  mediaType: z.string(),
  reservationId: z.string(),
  petId: z.string(),
  staffId: z.string().nullable(),
  createdAt: z.coerce.date(),
});

export const CreateStayUpdateSchema = StayUpdateSchema.omit({
  id: true,
  createdAt: true,
}).extend({
  mediaType: z.enum(["image", "video"]).default("image"),
});

export type StayUpdate = z.infer<typeof StayUpdateSchema>;
export type CreateStayUpdate = z.infer<typeof CreateStayUpdateSchema>;

// ========================
// Notification
// ========================

export const NotificationSchema = z.object({
  id: z.string().cuid(),
  type: NotificationTypeEnum,
  title: z.string().min(1),
  body: z.string().min(1),
  isRead: z.boolean(),
  data: z.any().nullable(),
  userId: z.string(),
  createdAt: z.coerce.date(),
});

export type Notification = z.infer<typeof NotificationSchema>;

// ========================
// DailyChecklist
// ========================

export const DailyChecklistSchema = z.object({
  id: z.string().cuid(),
  date: z.coerce.date(),
  energy: EnergyLevelEnum,
  socialization: SocializationLevelEnum,
  rest: RestQualityEnum,
  mealsCompleted: z.boolean(),
  mealsNotes: z.string().nullable(),
  walksCompleted: z.boolean(),
  bathroomBreaks: z.boolean(),
  playtime: z.boolean(),
  socializationDone: z.boolean(),
  mood: MoodLevelEnum,
  feedingNotes: z.string().nullable(),
  behaviorNotes: z.string().nullable(),
  additionalNotes: z.string().nullable(),
  photosCount: z.number().int(),
  videosCount: z.number().int(),
  reservationId: z.string(),
  staffId: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const CreateDailyChecklistSchema = z.object({
  date: z.coerce.date(),
  energy: EnergyLevelEnum,
  socialization: SocializationLevelEnum,
  rest: RestQualityEnum,
  mealsCompleted: z.boolean().default(false),
  mealsNotes: z.string().nullable().default(null),
  walksCompleted: z.boolean().default(false),
  bathroomBreaks: z.boolean().default(false),
  playtime: z.boolean().default(false),
  socializationDone: z.boolean().default(false),
  mood: MoodLevelEnum,
  feedingNotes: z.string().nullable().default(null),
  behaviorNotes: z.string().nullable().default(null),
  additionalNotes: z.string().nullable().default(null),
  reservationId: z.string(),
});

export const UpdateDailyChecklistSchema = CreateDailyChecklistSchema.partial().omit({
  reservationId: true,
  date: true,
});

export type DailyChecklist = z.infer<typeof DailyChecklistSchema>;
export type CreateDailyChecklist = z.infer<typeof CreateDailyChecklistSchema>;

// ========================
// BehaviorTag
// ========================

export const BehaviorTagSchema = z.object({
  id: z.string().cuid(),
  tag: BehaviorTagValueEnum,
  notes: z.string().nullable(),
  stayId: z.string(),
  petId: z.string(),
  staffId: z.string(),
  createdAt: z.coerce.date(),
});

export const CreateBehaviorTagSchema = z.object({
  tag: BehaviorTagValueEnum,
  notes: z.string().nullable().default(null),
  stayId: z.string(),
  petId: z.string(),
});

export type BehaviorTag = z.infer<typeof BehaviorTagSchema>;
export type CreateBehaviorTag = z.infer<typeof CreateBehaviorTagSchema>;

// ========================
// StaffAlert
// ========================

export const StaffAlertSchema = z.object({
  id: z.string().cuid(),
  type: AlertTypeEnum,
  description: z.string().min(1),
  isResolved: z.boolean(),
  resolvedAt: z.coerce.date().nullable(),
  reservationId: z.string(),
  petId: z.string(),
  staffId: z.string(),
  createdAt: z.coerce.date(),
});

export const CreateStaffAlertSchema = z.object({
  type: AlertTypeEnum,
  description: z.string().min(1),
  reservationId: z.string(),
  petId: z.string(),
});

export type StaffAlert = z.infer<typeof StaffAlertSchema>;
export type CreateStaffAlert = z.infer<typeof CreateStaffAlertSchema>;

// ========================
// Review
// ========================

export const ReviewSchema = z.object({
  id: z.string().cuid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().nullable(),
  reservationId: z.string(),
  ownerId: z.string(),
  // Agrupa las reseñas de una misma visita multi-mascota (= groupId ?? id).
  // Nullable por las reseñas anteriores a la migración de agosto 2026.
  groupKey: z.string().nullable().optional(),
  createdAt: z.coerce.date(),
});

export const CreateReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().nullable().default(null),
  reservationId: z.string(),
});

/**
 * Visita terminada que aún espera reseña. La devuelve `GET /reviews/pending`
 * para el pop-up del inicio; una visita puede abarcar varias reservaciones
 * (una por mascota) y se califica UNA sola vez.
 */
export const PendingReviewSchema = z.object({
  groupKey: z.string(),
  reservationIds: z.array(z.string()).min(1),
  // Enum inline a propósito: `ReservationTypeEnum` se declara más abajo en este
  // archivo y usarlo aquí reventaría por TDZ al evaluar el módulo.
  reservationType: z.enum(["STAY", "BATH", "DAYCARE"]),
  petNames: z.array(z.string()),
  endedAt: z.coerce.date(),
  /** Cuántas veces el cliente ya le dio "Más tarde" (máximo 3). */
  promptCount: z.number().int(),
});

export type Review = z.infer<typeof ReviewSchema>;
export type CreateReview = z.infer<typeof CreateReviewSchema>;
export type PendingReview = z.infer<typeof PendingReviewSchema>;

/**
 * Textos de la reseña por tipo de servicio. Único lugar donde se decide si algo
 * se llama "estancia", "baño" o "guardería": lo usan el push del API y el modal
 * de la app, que antes decían "estancia" incluso para un baño.
 */
export const REVIEW_COPY: Record<
  "STAY" | "BATH" | "DAYCARE",
  {
    /** Push: `${pushTitle(quién)}` */
    pushTitle: (who: string) => string;
    pushBody: string;
    /** Modal de la app */
    modalTitle: string;
    modalSubtitle: string;
    placeholder: (who: string) => string;
    /** CTA del detalle de la reservación */
    cta: string;
  }
> = {
  STAY: {
    pushTitle: (who) => `¿Cómo estuvo la estancia de ${who}? 🐾`,
    pushBody: "Califícanos con patitas y cuéntanos cómo la pasó.",
    modalTitle: "¿Cómo estuvo la estancia?",
    modalSubtitle: "Tu opinión nos ayuda a mejorar el servicio",
    placeholder: (who) => `Cuéntanos cómo la pasó ${who}…`,
    cta: "Califica esta estancia",
  },
  BATH: {
    pushTitle: (who) => `¿Cómo quedó el baño de ${who}? 🛁`,
    pushBody: "Califica el servicio de estética y déjanos un comentario.",
    modalTitle: "¿Cómo quedó el baño?",
    modalSubtitle: "Tu opinión nos ayuda a mejorar el servicio",
    placeholder: (who) => `Cuéntanos cómo quedó ${who}…`,
    cta: "Califica este baño",
  },
  DAYCARE: {
    pushTitle: (who) => `¿Qué tal la guardería de ${who}? ☀️`,
    pushBody: "Cuéntanos cómo le fue hoy. Tu opinión nos ayuda a mejorar.",
    modalTitle: "¿Qué tal la guardería?",
    modalSubtitle: "Tu opinión nos ayuda a mejorar el servicio",
    placeholder: (who) => `Cuéntanos cómo le fue a ${who}…`,
    cta: "Califica esta guardería",
  },
};

/** "Bailey" · "Bailey y Rocco" · "tus peluditos" (3 o más). */
export function reviewWho(names: string[]): string {
  if (names.length === 0) return "tu peludito";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} y ${names[1]}`;
  return "tus peluditos";
}

// ========================
// Services (Baño y otros addons)
// ========================

export const AddonPaymentSourceEnum = z.enum(["BOOKING", "STANDALONE"]);
export type AddonPaymentSource = z.infer<typeof AddonPaymentSourceEnum>;

export const ServiceVariantSchema = z.object({
  id: z.string().cuid(),
  serviceTypeId: z.string(),
  petSize: PetSizeEnum,
  deslanado: z.boolean(),
  corte: z.boolean(),
  price: z.number(),
  isActive: z.boolean(),
});
export type ServiceVariant = z.infer<typeof ServiceVariantSchema>;

export const ServiceTypeSchema = z.object({
  id: z.string().cuid(),
  code: z.string(),
  name: z.string(),
  isActive: z.boolean(),
});
export type ServiceType = z.infer<typeof ServiceTypeSchema>;

export const ReservationAddonSchema = z.object({
  id: z.string().cuid(),
  reservationId: z.string(),
  variantId: z.string(),
  unitPrice: z.number(),
  paidWith: AddonPaymentSourceEnum,
  paymentId: z.string().nullable(),
  createdAt: z.coerce.date(),
});
export type ReservationAddon = z.infer<typeof ReservationAddonSchema>;

export const CreateBathAddonSchema = z.object({
  petId: z.string(),
  deslanado: z.boolean(),
  corte: z.boolean(),
});
export type CreateBathAddon = z.infer<typeof CreateBathAddonSchema>;

export const ConfirmBathAddonSchema = z.object({
  paymentIntentId: z.string(),
});
export type ConfirmBathAddon = z.infer<typeof ConfirmBathAddonSchema>;

// ========================
// Bath Appointment (standalone — no hotel stay)
// ========================

export const ReservationTypeEnum = z.enum(["STAY", "BATH", "DAYCARE"]);
export type ReservationTypeValue = z.infer<typeof ReservationTypeEnum>;

export const BathConfigSchema = z.object({
  id: z.string(),
  openHour: z.number().int().min(0).max(23),
  // Hora a la que sale la estilista. La agenda garantiza que ninguna cita
  // termine después de esta hora.
  closeHour: z.number().int().min(1).max(24),
  // DEPRECADA: era la duración única de todo baño. La real vive por variante
  // en service_variants.durationMinutes. Se sigue enviando por compatibilidad.
  slotMinutes: z.number().int().min(15).max(240),
  maxConcurrentBaths: z.number().int().min(1),
  isActive: z.boolean(),
  // Cada cuánto se ofrece un inicio de cita (ya no es igual a la duración).
  slotStepMinutes: z.number().int().min(5).max(120),
  // Respaldo cuando no se puede resolver la variante del servicio.
  defaultBathDurationMinutes: z.number().int().min(15).max(480),
  // Tope duro opcional del último inicio del día.
  lastStartHour: z.number().int().min(0).max(23).nullable(),
  // Limpieza entre perro y perro.
  bufferMinutes: z.number().int().min(0).max(60),
  updatedAt: z.coerce.date(),
});
export type BathConfig = z.infer<typeof BathConfigSchema>;

export const UpdateBathConfigSchema = z.object({
  openHour: z.number().int().min(0).max(23).optional(),
  closeHour: z.number().int().min(1).max(24).optional(),
  slotMinutes: z.number().int().min(15).max(240).optional(),
  maxConcurrentBaths: z.number().int().min(1).optional(),
  isActive: z.boolean().optional(),
  slotStepMinutes: z.number().int().min(5).max(120).optional(),
  defaultBathDurationMinutes: z.number().int().min(15).max(480).optional(),
  lastStartHour: z.number().int().min(0).max(23).nullable().optional(),
  bufferMinutes: z.number().int().min(0).max(60).optional(),
});
export type UpdateBathConfig = z.infer<typeof UpdateBathConfigSchema>;

export const CreateBathIntentSchema = z.object({
  petId: z.string(),
  deslanado: z.boolean(),
  corte: z.boolean(),
  appointmentAt: z.string().datetime(),  // ISO UTC — debe ser un slot válido
  notes: z.string().max(500).optional(),
  // DEPOSIT: solo cobra el anticipo ahora, el resto al recoger.
  // FULL: cobra el precio total ahora.
  paymentType: z.enum(["DEPOSIT", "FULL"]).default("DEPOSIT"),
  homeDelivery: HomeDeliveryInputSchema.optional(),
  // Código de descuento opcional (alcance RESERVATIONS/BOTH). El servidor lo
  // valida y aplica; el monto lo calcula server-side (nunca se confía al cliente).
  discountCode: z.string().max(40).optional(),
});
export type CreateBathIntent = z.infer<typeof CreateBathIntentSchema>;

export const ConfirmBathSchema = z.object({
  paymentIntentId: z.string(),
  // Solo se usa en la ruta credit-only (sin PaymentIntent): el servidor re-valida
  // el código. En el flujo Stripe el descuento se lee del metadata del PI.
  discountCode: z.string().max(40).optional(),
});
export type ConfirmBath = z.infer<typeof ConfirmBathSchema>;

// ========================
// Guardería (DAYCARE) — servicio de día cobrado por hora.
// Reserva de UN día (multi-mascota) con entrada/salida estimadas; el cliente
// paga el estimado completo al reservar y el excedente real se cobra al
// recoger como add-on EXTRA_HOURS.
// ========================

export const CreateDaycareIntentSchema = z.object({
  petIds: z.array(z.string()).min(1).max(6),
  // Día de la guardería (fecha local del hotel, "YYYY-MM-DD").
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (YYYY-MM-DD)"),
  checkInTime: TimeHHmmSchema,
  checkOutTime: TimeHHmmSchema,
  notes: z.string().max(500).optional(),
  homeDelivery: HomeDeliveryInputSchema.optional(),
  // El servidor valida y calcula el monto; nunca se confía al cliente.
  discountCode: z.string().max(40).optional(),
});
export type CreateDaycareIntent = z.infer<typeof CreateDaycareIntentSchema>;

export const ConfirmDaycareSchema = z.object({
  // Null cuando el saldo a favor cubrió el total y no se creó PaymentIntent;
  // en ese caso el servidor re-valida los campos eco del intent.
  paymentIntentId: z.string().nullable(),
  petIds: z.array(z.string()).min(1).max(6).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  checkInTime: TimeHHmmSchema.optional(),
  checkOutTime: TimeHHmmSchema.optional(),
  notes: z.string().max(500).optional(),
  homeDelivery: HomeDeliveryInputSchema.optional(),
  discountCode: z.string().max(40).optional(),
});
export type ConfirmDaycare = z.infer<typeof ConfirmDaycareSchema>;

// ========================
// Tienda en línea (e-commerce) — DTOs del sitio web
// La dirección de envío del checkout reutiliza HomeDeliveryInputSchema (mismo
// shape address/lat/lng/placeId); el backend SIEMPRE recalcula la tarifa.
// ========================

export const FulfillmentTypeEnum = z.enum([
  "PICKUP",
  "LOCAL_DELIVERY",
  "NATIONAL_SHIPPING",
]);
export type FulfillmentType = z.infer<typeof FulfillmentTypeEnum>;

// Reseña de producto creada por el cliente. Entra como NO aprobada; el admin la
// modera antes de publicarla. `authorName` se muestra públicamente.
export const CreateProductReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(120).nullable().optional(),
  body: z.string().trim().min(1).max(1500),
  authorName: z.string().trim().min(1).max(80),
});
export type CreateProductReview = z.infer<typeof CreateProductReviewSchema>;

// ========================
// Cotizaciones
// ========================

export const QuoteStatusEnum = z.enum(["DRAFT", "SENT", "CONVERTED", "CANCELLED"]);
export type QuoteStatus = z.infer<typeof QuoteStatusEnum>;

export const QuoteItemKindEnum = z.enum([
  "LODGING",
  "DAYCARE",
  "BATH",
  "DEWORMING",
  "EXTRA_HOURS",
  "MEDICATION_SURCHARGE",
  "HOME_DELIVERY",
  "DISCOUNT",
  "CUSTOM",
]);

// Día como "YYYY-MM-DD". Las cotizaciones NUNCA viajan con Date ni con ISO
// completo: el usuario elige DÍAS, y un instante serializado desde un picker
// local se corre de día al pasar a UTC (ver nightsBetweenYMD en ./pricing).
export const DateYMDSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (formato YYYY-MM-DD)");

// Perro a cotizar. `petId` cuando ya existe en la base; los demás campos son el
// snapshot que se congela en `quote_pets` (y la ÚNICA fuente de datos cuando se
// le cotiza a un prospecto sin cuenta).
export const QuotePetInputSchema = z.object({
  petId: z.string().optional(),
  name: z.string().trim().min(1).max(60),
  weightKg: z.number().positive().max(120).nullable().optional(),
  size: PetSizeEnum.nullable().optional(),
  breed: z.string().trim().max(80).nullable().optional(),
  hasMedication: z.boolean().optional(),
  medicationNotes: z.string().trim().max(500).nullable().optional(),
});

export const QuoteCustomItemSchema = z.object({
  label: z.string().trim().min(1).max(80),
  detail: z.string().trim().max(160).nullable().optional(),
  quantity: z.number().positive().max(999).default(1),
  unitPrice: z.number().nonnegative(),
});

// Lo que hace falta para CALCULAR. Es el cuerpo de POST /quotes/preview y el
// núcleo de POST /quotes.
export const QuotePreviewSchema = z.object({
  // DELIVERY = cotizar SOLO el traslado, sin servicio en el hotel.
  serviceType: z.enum(["STAY", "BATH", "DAYCARE", "DELIVERY"]),
  // Sin `.min(1)` en el schema base: DELIVERY se cotiza sin mascotas (el viaje
  // se cobra por camioneta). El mínimo lo exige el superRefine de abajo para
  // los otros tres servicios, que sí se cotizan por perro.
  pets: z.array(QuotePetInputSchema).max(10),
  checkIn: DateYMDSchema.nullable().optional(),
  checkOut: DateYMDSchema.nullable().optional(),
  date: DateYMDSchema.nullable().optional(),
  checkInTime: TimeHHmmSchema.nullable().optional(),
  checkOutTime: TimeHHmmSchema.nullable().optional(),
  // Noches pactadas a mano cuando el cliente aún no tiene fechas cerradas.
  nightsOverride: z.number().int().positive().max(365).nullable().optional(),
  bath: BathSelectionSchema.nullable().optional(),
  deworming: z.boolean().optional(),
  probarf: z.boolean().optional(),
  extraHours: z.number().int().min(1).max(24).nullable().optional(),
  // Dirección + coordenadas; la TARIFA la recotiza siempre el servidor con
  // quoteDelivery (nunca se acepta un fee del cliente).
  homeDelivery: HomeDeliveryInputSchema.nullable().optional(),
  discountCode: z.string().trim().max(40).nullable().optional(),
  // Conceptos regalados: se imprimen con su precio de catálogo pero no suman.
  courtesy: z.array(QuoteItemKindEnum).optional(),
  customItems: z.array(QuoteCustomItemSchema).max(10).optional(),
  // Total pactado del GRUPO. El domicilio siempre se suma aparte.
  totalOverride: z.number().nonnegative().nullable().optional(),
}).superRefine((v, ctx) => {
  if (v.serviceType !== "DELIVERY" && v.pets.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["pets"],
      message: "Agrega al menos una mascota",
    });
  }
  // Una cotización de solo traslado sin dirección no cotiza nada. Se ataja
  // aquí para que el error hable de la dirección y no de un total en $0.
  if (v.serviceType === "DELIVERY" && !v.homeDelivery) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["homeDelivery"],
      message: "Indica la dirección del servicio a domicilio",
    });
  }
});
export type QuotePreviewInput = z.infer<typeof QuotePreviewSchema>;

// POST /quotes — lo de arriba más a quién se le cotiza y cómo se presenta.
export const CreateQuoteSchema = QuotePreviewSchema.extend({
  // Cliente existente. Si falta, es un prospecto y `clientName` es obligatorio
  // (el CHECK de la tabla exige uno de los dos).
  ownerId: z.string().nullable().optional(),
  clientName: z.string().trim().min(1).max(120),
  clientPhone: z.string().trim().max(30).nullable().optional(),
  clientEmail: z.string().trim().email().max(160).nullable().optional(),
  // Nota VISIBLE para el cliente: sale en el link y en el PDF.
  notes: z.string().trim().max(1000).nullable().optional(),
  // Nota del EQUIPO: nunca sale por la ruta pública ni en el PDF.
  internalNotes: z.string().trim().max(1000).nullable().optional(),
  validUntil: DateYMDSchema.optional(),
  depositSuggested: z.number().nonnegative().nullable().optional(),
  source: z.enum(["APP_ADMIN", "WEB_ADMIN"]).optional(),
  // Correo de quien cotiza. Lo manda SOLO el admin web: su Clerk es otra
  // instancia, así que la API no puede resolver al autor desde el token y lo
  // busca por email (ver resolveActor en routes/quotes.ts). La app móvil no lo
  // manda: ahí el actor sale del token.
  actorEmail: z.string().trim().email().max(160).optional(),
});
export type CreateQuote = z.infer<typeof CreateQuoteSchema>;

// PATCH /quotes/:id — solo lo editable sin recotizar. Cambiar los servicios o
// las fechas exige recalcular, así que va por otro camino (recrear/duplicar).
export const UpdateQuoteSchema = z.object({
  status: QuoteStatusEnum.optional(),
  validUntil: DateYMDSchema.optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  internalNotes: z.string().trim().max(1000).nullable().optional(),
  clientPhone: z.string().trim().max(30).nullable().optional(),
  clientEmail: z.string().trim().email().max(160).nullable().optional(),
  depositSuggested: z.number().nonnegative().nullable().optional(),
});
export type UpdateQuote = z.infer<typeof UpdateQuoteSchema>;

// ========================
// Pricing & sizing — re-exportado desde ./pricing (módulo puro, SIN zod).
// Vive en un archivo aparte para que la app móvil pueda importar estas
// funciones sin arrastrar zod al bundle. FUENTE ÚNICA: no redefinir en
// rutas ni pantallas.
// ========================
export * from "./pricing";

// Cotizaciones — cálculo del desglose. Mismo criterio que ./pricing: módulo
// puro y sin zod, para que el preview del móvil no arrastre el bundle.
export * from "./quote";

// Plantilla del documento que ve el cliente (página pública y PDF). El tipo
// PublicQuote que recibe es la allowlist de lo que puede salir hacia afuera.
export * from "./quoteHtml";
