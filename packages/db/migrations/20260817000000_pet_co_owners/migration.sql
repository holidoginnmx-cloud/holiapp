-- Un perro, dos cuentas (co-dueño).
--
-- Caso real: Andrea y Jesús son esposos y dueños de la misma perra. Jesús la
-- registró, así que `pets.ownerId` apunta a él; Andrea bajó la app y no ve
-- nada, solo el estado vacío de "registra a tu peludito". Sin esto, su única
-- salida es registrar al mismo perro otra vez: perro duplicado, cartilla
-- duplicada por revisar e historial partido en dos.
--
-- La tabla es ADITIVA: `pets.ownerId` no se toca nunca, solo se amplía quién
-- puede ver y actuar sobre la mascota. El unique (petId,userId) hace el
-- vínculo idempotente y sirve de índice para resolver la audiencia de las
-- notificaciones; el índice por userId es el que usan los listados del
-- co-dueño. ON DELETE CASCADE en ambos lados porque el panel web sí borra
-- perros en duro (perros/revisar) y no debe dejar filas huérfanas.
CREATE TABLE "pet_co_owners" (
    "id" TEXT NOT NULL,
    "petId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "createdByEmail" TEXT,

    CONSTRAINT "pet_co_owners_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pet_co_owners_petId_userId_key" ON "pet_co_owners"("petId", "userId");

CREATE INDEX "pet_co_owners_userId_idx" ON "pet_co_owners"("userId");

ALTER TABLE "pet_co_owners" ADD CONSTRAINT "pet_co_owners_petId_fkey" FOREIGN KEY ("petId") REFERENCES "pets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pet_co_owners" ADD CONSTRAINT "pet_co_owners_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Quién del equipo hizo el vínculo. SET NULL: dar de baja a un admin no debe
-- borrar la co-propiedad de un cliente.
ALTER TABLE "pet_co_owners" ADD CONSTRAINT "pet_co_owners_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- `reservations` no tenía NINGÚN índice por petId: el listado del co-dueño
-- filtra por `petId IN (...)`, y sin esto sería un seq scan sobre la tabla que
-- más crece. También le sirve al overlap guard de POST /reservations y al
-- historial de la mascota, que ya filtraban por petId sin índice.
CREATE INDEX "reservations_petId_status_idx" ON "reservations"("petId", "status");
