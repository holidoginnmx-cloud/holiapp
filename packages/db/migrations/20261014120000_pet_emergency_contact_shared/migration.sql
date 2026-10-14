-- El contacto de emergencia es del CLIENTE, no del perro: quien tiene tres perros
-- tiene un solo contacto. Las columnas se quedan en `pets` (las leen la app, el
-- panel web, los documentos legales y la fusión de fichas), pero a partir de aquí
-- la base las mantiene iguales en todas las mascotas del mismo `ownerId`.
--
-- Va en un trigger y no en el API porque hay dos escritores: el API (app móvil) y
-- el panel web, que escribe directo a Supabase. Así nadie puede olvidarse.
--
-- Reglas:
--   1. Alta sin contacto → hereda el de su familia (la mascota más recién editada).
--   2. Alta o edición CON contacto → se copia a las demás mascotas del dueño.
--   3. Un contacto vacío NO se replica: un escritor que manda nulls por descuido
--      (o la anonimización de una cuenta) no debe borrarle el contacto a la familia.
--   El co-dueño (`pet_co_owners`) no cuenta: la familia es el `ownerId`.

CREATE OR REPLACE FUNCTION pets_emergency_contact_inherit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  fuente RECORD;
BEGIN
  IF NULLIF(btrim(NEW."emergencyContactName"), '') IS NOT NULL
     OR NULLIF(btrim(NEW."emergencyContactPhone"), '') IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT "emergencyContactName", "emergencyContactPhone", "emergencyContactRelation"
    INTO fuente
    FROM pets
   WHERE "ownerId" = NEW."ownerId"
     AND (NULLIF(btrim("emergencyContactName"), '') IS NOT NULL
          OR NULLIF(btrim("emergencyContactPhone"), '') IS NOT NULL)
   ORDER BY "isActive" DESC, "updatedAt" DESC
   LIMIT 1;

  IF FOUND THEN
    NEW."emergencyContactName" := fuente."emergencyContactName";
    NEW."emergencyContactPhone" := fuente."emergencyContactPhone";
    NEW."emergencyContactRelation" := fuente."emergencyContactRelation";
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION pets_emergency_contact_share()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- El UPDATE de abajo vuelve a disparar este trigger en cada hermana: sin este
  -- corte, cada una intentaría replicar otra vez a las demás.
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;

  IF NULLIF(btrim(NEW."emergencyContactName"), '') IS NULL
     AND NULLIF(btrim(NEW."emergencyContactPhone"), '') IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE pets
     SET "emergencyContactName" = NEW."emergencyContactName",
         "emergencyContactPhone" = NEW."emergencyContactPhone",
         "emergencyContactRelation" = NEW."emergencyContactRelation"
   WHERE "ownerId" = NEW."ownerId"
     AND id <> NEW.id
     AND ("emergencyContactName" IS DISTINCT FROM NEW."emergencyContactName"
          OR "emergencyContactPhone" IS DISTINCT FROM NEW."emergencyContactPhone"
          OR "emergencyContactRelation" IS DISTINCT FROM NEW."emergencyContactRelation");
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_pets_emergency_contact_inherit ON pets;
CREATE TRIGGER trg_pets_emergency_contact_inherit
  BEFORE INSERT ON pets
  FOR EACH ROW EXECUTE FUNCTION pets_emergency_contact_inherit();

DROP TRIGGER IF EXISTS trg_pets_emergency_contact_share ON pets;
CREATE TRIGGER trg_pets_emergency_contact_share
  AFTER INSERT OR UPDATE OF "emergencyContactName", "emergencyContactPhone", "emergencyContactRelation"
  ON pets
  FOR EACH ROW EXECUTE FUNCTION pets_emergency_contact_share();

-- Relleno de lo que ya existe: solo las mascotas SIN contacto, y solo en familias
-- donde todos los contactos capturados apuntan al mismo teléfono. Si una familia
-- trae dos teléfonos distintos no se adivina cuál es el bueno: se unifica la
-- próxima vez que alguien edite una de sus mascotas.
WITH con_contacto AS (
  SELECT "ownerId",
         right(regexp_replace(coalesce("emergencyContactPhone", ''), '\D', '', 'g'), 10) AS tel
    FROM pets
   WHERE NULLIF(btrim("emergencyContactName"), '') IS NOT NULL
      OR NULLIF(btrim("emergencyContactPhone"), '') IS NOT NULL
),
familias_claras AS (
  SELECT "ownerId" FROM con_contacto GROUP BY "ownerId" HAVING count(DISTINCT tel) = 1
),
fuente AS (
  SELECT DISTINCT ON (p."ownerId")
         p."ownerId", p."emergencyContactName", p."emergencyContactPhone", p."emergencyContactRelation"
    FROM pets p
    JOIN familias_claras f ON f."ownerId" = p."ownerId"
   WHERE NULLIF(btrim(p."emergencyContactName"), '') IS NOT NULL
      OR NULLIF(btrim(p."emergencyContactPhone"), '') IS NOT NULL
   ORDER BY p."ownerId", p."isActive" DESC, p."updatedAt" DESC
)
UPDATE pets p
   SET "emergencyContactName" = fuente."emergencyContactName",
       "emergencyContactPhone" = fuente."emergencyContactPhone",
       "emergencyContactRelation" = fuente."emergencyContactRelation"
  FROM fuente
 WHERE p."ownerId" = fuente."ownerId"
   AND NULLIF(btrim(p."emergencyContactName"), '') IS NULL
   AND NULLIF(btrim(p."emergencyContactPhone"), '') IS NULL;
