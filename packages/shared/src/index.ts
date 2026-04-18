import { z } from "zod";

// ========================
// Enums
// ========================

export const RoleEnum = z.enum(["OWNER", "STAFF", "ADMIN"]);
export type Role = z.infer<typeof RoleEnum>;

export const PetSizeEnum = z.enum(["XS", "S", "M", "L", "XL"]);
export type PetSize = z.infer<typeof PetSizeEnum>;

export const CartillaStatusEnum = z.enum(["PENDING", "APPROVED", "REJECTED"]);
export type CartillaStatus = z.infer<typeof CartillaStatusEnum>;

export const ReservationStatusEnum = z.enum([
  "PENDING",
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
  cartillaUrl: z.string().nullable(),
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
  cartillaUrl: z.string().nullable().default(null),
});

export const UpdatePetSchema = CreatePetSchema.partial().omit({ ownerId: true });

export const ReviewCartillaSchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  reason: z.string().max(500).optional(),
});
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
  petId: z.string(),
  createdAt: z.coerce.date(),
});

export const CreateVaccineSchema = VaccineSchema.omit({
  id: true,
  petId: true,
  createdAt: true,
});

export type Vaccine = z.infer<typeof VaccineSchema>;
export type CreateVaccine = z.infer<typeof CreateVaccineSchema>;

// ========================
// Room
// ========================

export const RoomSchema = z.object({
  id: z.string().cuid(),
  name: z.string().min(1),
  description: z.string().nullable(),
  capacity: z.number().int().positive(),
  sizeAllowed: z.array(PetSizeEnum),
  pricePerDay: z.number().nonnegative(),
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
  checkIn: z.coerce.date(),
  checkOut: z.coerce.date(),
  status: ReservationStatusEnum,
  totalDays: z.number().int().positive(),
  totalAmount: z.number().nonnegative(),
  notes: z.string().nullable(),
  legalAccepted: z.boolean(),
  groupId: z.string().nullable(),
  paymentType: z.string().nullable(),
  depositDeadline: z.coerce.date().nullable(),
  ownerId: z.string(),
  petId: z.string(),
  roomId: z.string().nullable(),
  staffId: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const CreateReservationSchema = z.object({
  checkIn: z.coerce.date(),
  checkOut: z.coerce.date(),
  notes: z.string().nullable().default(null),
  legalAccepted: z.boolean(),
  ownerId: z.string(),
  petId: z.string(),
  roomId: z.string().optional(),
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

export const CreateMultiReservationSchema = z.object({
  checkIn: z.coerce.date(),
  checkOut: z.coerce.date(),
  notes: z.string().nullable().default(null),
  legalAccepted: z.boolean(),
  ownerId: z.string(),
  petIds: z.array(z.string()).min(1),
  roomPreference: z.enum(["shared", "separate"]),
  stripePaymentIntentId: z.string(),
  paymentType: z.enum(["FULL", "DEPOSIT"]).default("FULL"),
  bathSelectionsByPet: z.record(z.string(), BathSelectionSchema).optional(),
  medicationByPet: z.record(z.string(), MedicationSelectionSchema).optional(),
});

export const UpdateReservationStatusSchema = z.object({
  status: ReservationStatusEnum,
});

export type Reservation = z.infer<typeof ReservationSchema>;
export type CreateReservation = z.infer<typeof CreateReservationSchema>;
export type CreateMultiReservation = z.infer<typeof CreateMultiReservationSchema>;

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
