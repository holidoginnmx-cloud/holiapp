-- Conciliación de los depósitos SPEI de Stripe.
--
-- PROBLEMA: a la cuenta del hotel le llega un SPEI de "Stripe Payments Mexico"
-- por un monto agregado (p. ej. $663.80) que junta N cobros de clientes
-- distintos. El SPEI no trae referencia útil, y lo único que guardábamos hacia
-- Stripe era `payments.stripePaymentIntentId` + `payments.stripeFeeAmount`, así
-- que no había manera de contestar "¿de qué reserva es este depósito?" sin
-- abrir el dashboard de Stripe y cruzar a mano.
--
-- `stripe_payouts`: un renglón por depósito. `amount` es el NETO que cae al
-- banco — el número exacto que el dueño ve en su estado de cuenta — y por eso
-- lleva índice: la búsqueda natural es "me llegaron $663.80, ¿de qué son?".
-- `arrivalDate` es la fecha del abono, distinta de `stripeCreatedAt` porque
-- Stripe emite el payout antes de que el dinero llegue.
--
-- `stripe_payout_lines`: un renglón por balance transaction de Stripe. El
-- invariante es SUM(net) = stripe_payouts.amount, así que se guardan TODAS las
-- líneas, incluidas las que no cruzan con ningún pago nuestro (ajustes,
-- disputas, cobros huérfanos). Descartarlas haría que el desglose no cuadrara
-- y el dueño no sabría por qué le faltan pesos.
--
-- El PK es el `txn_...` de Stripe, no un cuid: eso hace que re-sincronizar un
-- payout sea un UPSERT sin duplicados, sin necesidad de borrar y reinsertar.
--
-- `paymentId`/`orderId` son ON DELETE SET NULL (no CASCADE) a propósito: si se
-- borra un pago, la línea debe sobrevivir como "no identificada" en vez de
-- desaparecer y descuadrar el total del depósito. Son dos FKs distintas porque
-- los pedidos de tienda NO generan filas en `payments` (ver handleStoreOrderPaid)
-- pero sí viajan en el mismo depósito.
--
-- `type` queda como TEXT y no como enum: Stripe agrega tipos de balance
-- transaction sin avisar, y con un enum el sync completo tronaría por un tipo
-- desconocido en vez de degradar esa sola línea a "ajuste".
--
-- Migración puramente aditiva (tablas nuevas + un valor de enum): es segura de
-- correr con la API y el admin web viejos todavía en producción.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'PAYOUT_PAID';

-- CreateTable
CREATE TABLE "stripe_payouts" (
    "id" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'mxn',
    "status" TEXT NOT NULL,
    "arrivalDate" TIMESTAMP(3) NOT NULL,
    "stripeCreatedAt" TIMESTAMP(3) NOT NULL,
    "failureMessage" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stripe_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stripe_payout_lines" (
    "id" TEXT NOT NULL,
    "payoutId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "gross" DECIMAL(10,2) NOT NULL,
    "fee" DECIMAL(10,2) NOT NULL,
    "net" DECIMAL(10,2) NOT NULL,
    "description" TEXT,
    "chargeId" TEXT,
    "stripePaymentIntentId" TEXT,
    "paymentId" TEXT,
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stripe_payout_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stripe_payouts_arrivalDate_idx" ON "stripe_payouts"("arrivalDate");

-- CreateIndex
CREATE INDEX "stripe_payouts_amount_idx" ON "stripe_payouts"("amount");

-- CreateIndex
CREATE INDEX "stripe_payout_lines_payoutId_idx" ON "stripe_payout_lines"("payoutId");

-- CreateIndex
CREATE INDEX "stripe_payout_lines_stripePaymentIntentId_idx" ON "stripe_payout_lines"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "stripe_payout_lines_paymentId_idx" ON "stripe_payout_lines"("paymentId");

-- CreateIndex
CREATE INDEX "stripe_payout_lines_orderId_idx" ON "stripe_payout_lines"("orderId");

-- AddForeignKey
ALTER TABLE "stripe_payout_lines" ADD CONSTRAINT "stripe_payout_lines_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "stripe_payouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stripe_payout_lines" ADD CONSTRAINT "stripe_payout_lines_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stripe_payout_lines" ADD CONSTRAINT "stripe_payout_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
