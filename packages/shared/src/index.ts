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
  name: z.string().min(1),
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
  /** @deprecated usar `cartillaPhotos`; queda por compatibilidad. */
  cartillaUrl: z.string().nullable(),
  cartillaPhotos: z.array(z.string()).default([]),
  cartillaStatus: CartillaStatusEnum.nullable(),
  cartillaReviewedAt: z.coerce.date().nullable(),
  cartillaReviewedById: z.string().nullable(),
  cartillaRejectionReason: z.string().nullable(),
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
  /** @deprecated usar `cartillaPhotos`. */
  cartillaUrl: z.string().nullable().default(null),
  cartillaPhotos: z.array(z.string()).default([]),
});

export const UpdatePetSchema = CreatePetSchema.partial().omit({ ownerId: true });

export const VaccineEntrySchema = z.object({
  catalogId: z.string().cuid(),
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
  // Instrucciones de medicamento (existe en la BD; staff la captura por estancia).
  medicationNotes: z.string().nullable().optional(),
  legalAccepted: z.boolean(),
  groupId: z.string().nullable(),
  // Hora estimada elegida por el cliente ("HH:mm", hora local del hotel).
  checkInTime: z.string().nullable().optional(),
  checkOutTime: z.string().nullable().optional(),
  paymentType: z.string().nullable(),
  depositDeadline: z.coerce.date().nullable(),
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
});
export type HomeDeliveryInput = z.infer<typeof HomeDeliveryInputSchema>;

export const CreateReservationSchema = z.object({
  reservationType: z.enum(["STAY", "BATH", "DAYCARE"]).default("STAY"),
  notes: z.string().nullable().default(null),
  legalAccepted: z.boolean(),
  ownerId: z.string(),
  petId: z.string(),
  // STAY
  checkIn: z.coerce.date().optional(),
  checkOut: z.coerce.date().optional(),
  roomId: z.string().optional(),
  // Baño como complemento de un hospedaje (STAY). En BATH se usan los campos
  // deslanado/corte de nivel superior.
  bath: BathSelectionSchema.optional(),
  // BATH (cita puntual; el precio se resuelve server-side desde la variante)
  // DAYCARE: appointmentAt = día de la guardería (se ancla a mediodía UTC).
  appointmentAt: z.coerce.date().optional(),
  deslanado: z.boolean().optional(),
  corte: z.boolean().optional(),
  // DAYCARE: entrada/salida estimadas; precio = horas × tarifa única. El total
  // sugerido puede sobrescribirse con totalAmountOverride (walk-in, admin).
  checkInTime: z.string().optional(),
  checkOutTime: z.string().optional(),
  totalAmountOverride: z.number().nonnegative().optional(),
  // Campos adicionales (creación manual desde admin)
  staffId: z.string().optional(),
  medicationNotes: z.string().nullable().optional(),
  depositAgreed: z.number().nonnegative().optional(),
  homeDelivery: HomeDeliveryInputSchema.optional(),
});

// Hora local del hotel en formato 24h "HH:mm" (p.ej. "09:30", "17:00").
export const TimeHHmmSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida (formato HH:mm)");

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
  paidAt: z.coerce.date().nullable(),
  notes: z.string().nullable(),
  reservationId: z.string(),
  userId: z.string(),
  createdAt: z.coerce.date(),
});

export const CreatePaymentSchema = PaymentSchema.omit({
  id: true,
  createdAt: true,
}).extend({
  status: PaymentStatusEnum.default("PAID"),
  paidAt: z.coerce.date().default(() => new Date()),
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
  createdAt: z.coerce.date(),
});

export const CreateReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().nullable().default(null),
  reservationId: z.string(),
});

export type Review = z.infer<typeof ReviewSchema>;
export type CreateReview = z.infer<typeof CreateReviewSchema>;

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
  closeHour: z.number().int().min(1).max(24),
  slotMinutes: z.number().int().min(15).max(240),
  maxConcurrentBaths: z.number().int().min(1),
  isActive: z.boolean(),
  updatedAt: z.coerce.date(),
});
export type BathConfig = z.infer<typeof BathConfigSchema>;

export const UpdateBathConfigSchema = z.object({
  openHour: z.number().int().min(0).max(23).optional(),
  closeHour: z.number().int().min(1).max(24).optional(),
  slotMinutes: z.number().int().min(15).max(240).optional(),
  maxConcurrentBaths: z.number().int().min(1).optional(),
  isActive: z.boolean().optional(),
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
// Pricing & sizing — re-exportado desde ./pricing (módulo puro, SIN zod).
// Vive en un archivo aparte para que la app móvil pueda importar estas
// funciones sin arrastrar zod al bundle. FUENTE ÚNICA: no redefinir en
// rutas ni pantallas.
// ========================
export * from "./pricing";
