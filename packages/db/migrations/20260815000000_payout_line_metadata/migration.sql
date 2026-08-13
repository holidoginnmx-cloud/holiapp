-- Metadata de Stripe en las líneas del depósito.
--
-- PROBLEMA: al abrir el desglose del depósito de $663.80, sus dos cobros salían
-- como "movimiento de Stripe sin reserva asociada". No es un fallo de la
-- conciliación: esos cobros nunca llegaron a `payments`, porque el webhook
-- `payment_intent.succeeded` NO crea el pago —espera que lo haya creado el
-- cliente tras confirmar— y si eso no pasó, solo queda un warning en el log.
--
-- Resultado: la pantalla cuadra al centavo pero no contesta la única pregunta
-- que la motivó, que es de quién era el dinero.
--
-- Stripe sí conserva el rastro: la metadata del PaymentIntent lleva `ownerId`,
-- `petId`/`petIds`, el tipo de servicio y la fecha, y **viaja ya en el charge
-- expandido** que el sync pide, sin llamadas extra. Se guarda aquí para poder
-- resolver cliente, mascota y reserva sin volver a hablar con Stripe.
--
-- `stripeMetadata` guarda el objeto completo (auditoría y campos que hoy no
-- usamos, como variantId o roomPreference); `metaOwnerId` y `metaPetIds` se
-- extraen aparte porque son los que se cruzan en lote contra users/pets.
--
-- Verificado contra los 5 cobros huérfanos que había en producción: los 2
-- reales (baños de un mismo cliente) resuelven a su reserva exacta; los otros 3
-- son cuentas de prueba de la revisión de Apple cuyas reservas ya no existen, y
-- para esos la metadata igual identifica al titular del cobro.
--
-- Aditiva y toda nullable: segura de correr con la API vieja todavía arriba.

-- `metaReservationId` es la vía exacta: los cobros de saldo, las extensiones de
-- estadía y los add-ons sueltos mandan el `reservationId` literal en la
-- metadata. Cuando está, no hay que adivinar nada.

-- AlterTable
ALTER TABLE "stripe_payout_lines" ADD COLUMN "stripeMetadata" JSONB;
ALTER TABLE "stripe_payout_lines" ADD COLUMN "metaOwnerId" TEXT;
ALTER TABLE "stripe_payout_lines" ADD COLUMN "metaPetIds" TEXT;
ALTER TABLE "stripe_payout_lines" ADD COLUMN "metaReservationId" TEXT;

-- CreateIndex
CREATE INDEX "stripe_payout_lines_metaOwnerId_idx" ON "stripe_payout_lines"("metaOwnerId");
