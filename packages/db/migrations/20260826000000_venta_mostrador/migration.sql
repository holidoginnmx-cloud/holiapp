-- Ventas de tienda dentro de los ingresos (mostrador y en línea).
--
-- PROBLEMA: los ingresos del admin salen exclusivamente de `payments`, y
-- `payments.reservationId` era NOT NULL con FK a `reservations`. Un pedido de
-- tienda no tiene reservación, así que NO podía existir como pago: el dinero de
-- la tienda quedaba fuera de "Ingresos del mes" aunque sí cayera al banco (de
-- hecho ya viajaba en los depósitos de Stripe, ver stripe_payout_lines.orderId).
-- Esto afectaba a TODAS las ventas en línea desde el primer día, y hacía
-- imposible registrar una venta presencial.
--
-- DECISIÓN: `payments.reservationId` pasa a NULLABLE y se agrega
-- `payments.orderId`. Un pago es de una reserva O de un pedido, nunca de los
-- dos. No se crea una tabla nueva de "ingresos" porque TODAS las vistas del
-- dashboard, la conciliación de depósitos y el desglose del admin móvil ya leen
-- `payments`: partir la fuente de verdad costaría más que ensancharla.
--
-- `orderId` es ON DELETE SET NULL (no CASCADE) por el mismo criterio que
-- stripe_payout_lines: si se borra un pedido, el ingreso ya reportado no debe
-- desaparecer de un mes cerrado. NO es UNIQUE: un pedido reembolsado genera un
-- segundo Payment con status REFUNDED (ver handleChargeRefunded). La
-- idempotencia del pago de ingreso la garantiza `stripePaymentIntentId`, que ya
-- es UNIQUE, y para el mostrador la propia transacción que crea orden y pago.
--
-- `orders.email` pasa a NULLABLE: una venta de mostrador en efectivo no tiene
-- cliente identificado. Un placeholder ("mostrador@…") sería peor: se ve como
-- un correo real en Tienda → Pedidos, es indistinguible de un pedido en línea de
-- ese buzón y algún día alguien le manda un correo. El checkout en línea lo
-- sigue exigiendo en la aplicación (routes/orders.ts valida con EMAIL_RE antes
-- de crear la orden), así que en línea nunca va a ser NULL.
--
-- `orders.channel` distingue el pedido de mostrador del de la tienda web sin
-- adivinar por `stripePaymentIntentId is null`. Default ONLINE: los pedidos que
-- ya existen son todos de la tienda web.
--
-- OJO con la FK de reservación: al volver opcional una relación, el default de
-- `onDelete` en Prisma pasa de Restrict a SetNull. Eso habría hecho que borrar
-- una reserva dejara pagos huérfanos con reservationId NULL — y la vista de
-- ingresos clasifica por `reservationId is null`, así que esos pagos habrían
-- aparecido como ventas de tienda. Por eso el schema fija `onDelete: Restrict`
-- explícito y esta migración NO recrea `payments_reservationId_fkey`.
--
-- SEGURA CON LA VERSIÓN VIEJA EN PRODUCCIÓN: aflojar un NOT NULL y agregar
-- columnas nullable o con default no rompe ningún INSERT existente. La API vieja
-- sigue escribiendo `reservationId` en cada pago y el admin web viejo no
-- selecciona ninguna de las columnas nuevas. Por eso esta migración puede (y
-- debe) ir a producción ANTES que el código que la usa.

-- CreateEnum
CREATE TYPE "OrderChannel" AS ENUM ('ONLINE', 'COUNTER');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "channel" "OrderChannel" NOT NULL DEFAULT 'ONLINE',
                     ALTER COLUMN  "email" DROP NOT NULL;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN    "orderId" TEXT,
                       ALTER COLUMN "reservationId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "payments_orderId_idx" ON "payments"("orderId");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
