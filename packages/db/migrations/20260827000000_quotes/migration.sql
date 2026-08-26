-- Cotizaciones: lo que se le PROMETE a alguien que todavía no reserva.
--
-- PROBLEMA: el equipo solo podía crear reservas. Cuando alguien preguntaba por
-- WhatsApp "¿cuánto sale dejar a mi perro 5 días con baño?", la única salida
-- era armar el número a mano y escribirlo en un mensaje. No quedaba registro de
-- qué se cotizó, a quién ni a qué precio, y si el cliente aceptaba tres días
-- después había que recapturar todo desde cero.
--
-- DECISIÓN: tablas propias en vez de reservas en estado "borrador". Una
-- cotización NO aparta cupo ni cuarto, NO entra a los ingresos y NO le notifica
-- nada al cliente; meterla en `reservations` la habría hecho aparecer en el
-- calendario, en la ocupación y en los barridos de mantenimiento. Su único
-- efecto sobre la operación ocurre al convertirse, y eso pasa por el mismo
-- POST /reservations de siempre.
--
-- Son TRES tablas y no una porque el precio depende del perro (talla, peso,
-- medicamento) y hay cotizaciones multi-perro. Un JSON con la foto de cada
-- perro obligaría a re-validarlo al convertir, no se podría consultar, y para
-- un prospecto sin cuenta ese JSON sería el único lugar donde existen los datos
-- del perro. `quote_pets` es una tabla de doce columnas: vale la pena.
--
-- Todo el dinero se congela al cotizar (misma idea que el desglose de
-- `reservations`): si mañana suben las tarifas, la cotización vigente sigue
-- diciendo lo que se prometió.
--
-- Migración puramente ADITIVA: no toca ninguna tabla existente, así que el
-- admin web (que lee las mismas tablas por Supabase) no se entera.

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'CONVERTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QuoteItemKind" AS ENUM ('LODGING', 'DAYCARE', 'BATH', 'DEWORMING', 'EXTRA_HOURS', 'MEDICATION_SURCHARGE', 'HOME_DELIVERY', 'DISCOUNT', 'CUSTOM');

-- CreateTable
CREATE TABLE "quotes" (
    "id" TEXT NOT NULL,
    "folio" SERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "reservationType" "ReservationType" NOT NULL,
    "checkIn" TIMESTAMPTZ(6),
    "checkOut" TIMESTAMPTZ(6),
    "appointmentAt" TIMESTAMPTZ(6),
    "checkInTime" TEXT,
    "checkOutTime" TEXT,
    "totalDays" INTEGER,
    "daycareHours" INTEGER,
    "ownerId" TEXT,
    "clientName" TEXT NOT NULL,
    "clientPhone" TEXT,
    "clientPhoneNormalized" TEXT,
    "clientEmail" TEXT,
    "subtotal" DECIMAL(10,2) NOT NULL,
    "discountTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "deliveryFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(10,2) NOT NULL,
    "depositSuggested" DECIMAL(10,2),
    "discountCodeId" TEXT,
    "discountCodeSnapshot" TEXT,
    "homeDelivery" BOOLEAN NOT NULL DEFAULT false,
    "homeDeliveryAddress" TEXT,
    "homeDeliveryLat" DOUBLE PRECISION,
    "homeDeliveryLng" DOUBLE PRECISION,
    "homeDeliveryPlaceId" TEXT,
    "homeDeliveryDistanceKm" DOUBLE PRECISION,
    "validUntil" TIMESTAMPTZ(6) NOT NULL,
    "notes" TEXT,
    "internalNotes" TEXT,
    "pricingSnapshot" JSONB,
    "createdById" TEXT NOT NULL,
    "source" TEXT,
    "sentAt" TIMESTAMPTZ(6),
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "firstViewedAt" TIMESTAMPTZ(6),
    "lastViewedAt" TIMESTAMPTZ(6),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "convertedAt" TIMESTAMPTZ(6),
    "reservationId" TEXT,
    "reservationGroupId" TEXT,
    "convertedById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_pets" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "petId" TEXT,
    "name" TEXT NOT NULL,
    "weightKg" DOUBLE PRECISION,
    "size" "PetSize",
    "breed" TEXT,
    "hasMedication" BOOLEAN NOT NULL DEFAULT false,
    "medicationNotes" TEXT,
    "subtotal" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "quote_pets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_items" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "quotePetId" TEXT,
    "kind" "QuoteItemKind" NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "detail" TEXT,
    "quantity" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "listPrice" DECIMAL(10,2) NOT NULL,
    "isCourtesy" BOOLEAN NOT NULL DEFAULT false,
    "courtesyReason" TEXT,
    "serviceVariantId" TEXT,

    CONSTRAINT "quote_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quotes_folio_key" ON "quotes"("folio");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_token_key" ON "quotes"("token");

-- CreateIndex
CREATE INDEX "quotes_status_createdAt_idx" ON "quotes"("status", "createdAt");

-- CreateIndex
CREATE INDEX "quotes_ownerId_createdAt_idx" ON "quotes"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "quotes_clientPhoneNormalized_idx" ON "quotes"("clientPhoneNormalized");

-- CreateIndex
CREATE INDEX "quotes_status_validUntil_idx" ON "quotes"("status", "validUntil");

-- CreateIndex
CREATE INDEX "quote_pets_petId_idx" ON "quote_pets"("petId");

-- CreateIndex
CREATE UNIQUE INDEX "quote_pets_quoteId_position_key" ON "quote_pets"("quoteId", "position");

-- CreateIndex
CREATE INDEX "quote_items_quoteId_position_idx" ON "quote_items"("quoteId", "position");

-- CreateIndex
CREATE INDEX "quote_items_quotePetId_idx" ON "quote_items"("quotePetId");

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_discountCodeId_fkey" FOREIGN KEY ("discountCodeId") REFERENCES "discount_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_convertedById_fkey" FOREIGN KEY ("convertedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_pets" ADD CONSTRAINT "quote_pets_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_pets" ADD CONSTRAINT "quote_pets_petId_fkey" FOREIGN KEY ("petId") REFERENCES "pets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_quotePetId_fkey" FOREIGN KEY ("quotePetId") REFERENCES "quote_pets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_serviceVariantId_fkey" FOREIGN KEY ("serviceVariantId") REFERENCES "service_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ── Invariantes que Prisma no puede expresar ────────────────────────────────

-- Toda cotización tiene destinatario: un cliente con cuenta O un prospecto con
-- nombre. Sin este CHECK, un bug de captura deja cotizaciones huérfanas que no
-- se pueden ni reenviar ni convertir.
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_destinatario_check"
  CHECK ("ownerId" IS NOT NULL OR length(trim("clientName")) > 0);

-- El token es lo ÚNICO que protege la página pública (/cotizacion/<token> es
-- anónima): nunca puede quedar corto por un bug del generador.
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_token_len_check"
  CHECK (length("token") >= 24);
