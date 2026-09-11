-- ============================================================================
-- Invitaciones para compartir una mascota, mandadas por el DUEÑO.
--
-- `pet_co_owners` ya permitía que un perro viviera en dos cuentas, pero el
-- vínculo solo lo podía crear el equipo. Mientras alguien no lo hacía a mano,
-- la pareja que instalaba la app veía el estado vacío y acababa registrando al
-- mismo perro otra vez (perro duplicado y cartilla duplicada por revisar).
--
-- Por qué una tabla y no un token firmado como el del claim (que es stateless
-- a propósito): una invitación tiene que poder CANCELARSE y gastarse UNA sola
-- vez, y ninguna de las dos cosas se puede sin guardar su estado.
--
-- Dos llaves para la misma fila, porque son dos caminos:
--   token → va en la liga que se manda por WhatsApp (128 bits).
--   code  → 8 caracteres que se teclean en la app. Existe porque la app no
--           tiene universal links: quien todavía no la tiene instalada pasa por
--           la página del sitio, se la baja, y al abrirla la liga ya no lo
--           espera. El código es lo único que sobrevive a ese viaje.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "pet_invites" (
  "id"           TEXT NOT NULL,
  "petId"        TEXT NOT NULL,
  "invitedById"  TEXT NOT NULL,
  "token"        TEXT NOT NULL,
  "code"         TEXT NOT NULL,
  "expiresAt"    TIMESTAMP(3) NOT NULL,
  "acceptedAt"   TIMESTAMP(3),
  "acceptedById" TEXT,
  "revokedAt"    TIMESTAMP(3),
  "revokedById"  TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pet_invites_pkey" PRIMARY KEY ("id")
);

-- Las dos llaves de entrada: se busca por una o por la otra, y ninguna se puede
-- repetir (el código corto se genera reintentando si choca).
CREATE UNIQUE INDEX IF NOT EXISTS "pet_invites_token_key" ON "pet_invites"("token");
CREATE UNIQUE INDEX IF NOT EXISTS "pet_invites_code_key" ON "pet_invites"("code");

-- Las invitaciones vivas de un perro: es lo que pinta la pantalla del dueño y
-- la tarjeta del equipo.
CREATE INDEX IF NOT EXISTS "pet_invites_petId_acceptedAt_idx"
  ON "pet_invites"("petId", "acceptedAt");
CREATE INDEX IF NOT EXISTS "pet_invites_invitedById_idx"
  ON "pet_invites"("invitedById");

-- Si el perro o quien invitó desaparecen, la invitación no tiene sentido.
ALTER TABLE "pet_invites"
  DROP CONSTRAINT IF EXISTS "pet_invites_petId_fkey";
ALTER TABLE "pet_invites"
  ADD CONSTRAINT "pet_invites_petId_fkey"
  FOREIGN KEY ("petId") REFERENCES "pets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pet_invites"
  DROP CONSTRAINT IF EXISTS "pet_invites_invitedById_fkey";
ALTER TABLE "pet_invites"
  ADD CONSTRAINT "pet_invites_invitedById_fkey"
  FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- En cambio, quien aceptó o canceló es historial: si esa cuenta se borra, la
-- fila se queda (sirve para explicarle al equipo de dónde salió un co-dueño).
ALTER TABLE "pet_invites"
  DROP CONSTRAINT IF EXISTS "pet_invites_acceptedById_fkey";
ALTER TABLE "pet_invites"
  ADD CONSTRAINT "pet_invites_acceptedById_fkey"
  FOREIGN KEY ("acceptedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pet_invites"
  DROP CONSTRAINT IF EXISTS "pet_invites_revokedById_fkey";
ALTER TABLE "pet_invites"
  ADD CONSTRAINT "pet_invites_revokedById_fkey"
  FOREIGN KEY ("revokedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Sin RLS, Supabase expone la tabla por su API REST (PostgREST) a quien tenga
-- la llave pública `anon`, y aquí cada fila trae un token y un código que son
-- credenciales al portador. El API entra como dueño de la tabla y el panel con
-- la llave de servicio: los dos se saltan RLS, así que activarla sin políticas
-- no les quita nada. Los REVOKE van condicionados porque en una base local no
-- existen los roles de Supabase.
ALTER TABLE "pet_invites" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "pet_invites" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON "pet_invites" FROM authenticated;
  END IF;
END $$;
