-- ============================================================================
-- Agenda de estética con duración real por servicio.
--
-- Hasta ahora la agenda asumía que TODO baño dura `bath_config.slotMinutes`
-- (60 min) y decidía el cupo comparando igualdad exacta de timestamp. En la
-- realidad un baño+corte de perro chico toma hora y media y un deslanado de
-- perro grande dos horas o más: las citas se encimaban y la última del día
-- terminaba después de que sale la estilista.
--
-- Esta migración da el sustrato para razonar por INTERVALOS [inicio, fin):
--   · service_variants.durationMinutes   → cuánto toma cada combinación
--   · reservations.durationMinutes       → snapshot al agendar (como unitPrice)
--   · reservation_addons.scheduledAt     → hora propia del baño de hospedaje
--   · bath_config.*                      → paso de rejilla, respaldo, buffer
--
-- Todo es ADITIVO y nullable o con default: el código en producción no ve
-- estas columnas y sigue funcionando igual hasta que se despliegue la API.
-- ============================================================================

-- ── Duración por variante ───────────────────────────────────────────────────
-- Nullable a propósito: DEWORMING y EXTRA_HOURS comparten esta tabla y no son
-- servicios agendables por hora. El resolver cae a
-- bath_config."defaultBathDurationMinutes" cuando viene NULL.
ALTER TABLE "service_variants"
  ADD COLUMN IF NOT EXISTS "durationMinutes" INTEGER;

-- ── Snapshot en la reserva (cita suelta de estética) ────────────────────────
-- Se congela al agendar para que cambiar la configuración NO mueva citas ya
-- agendadas, y para que el equipo pueda alargar una cita puntual.
ALTER TABLE "reservations"
  ADD COLUMN IF NOT EXISTS "durationMinutes" INTEGER;

-- Auditoría del "agendar de todos modos": la operación real tiene excepciones,
-- pero deben quedar visibles en la agenda en lugar de confundirse con citas
-- que sí cupieron.
ALTER TABLE "reservations"
  ADD COLUMN IF NOT EXISTS "scheduleOverridden" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "reservations"
  ADD COLUMN IF NOT EXISTS "scheduleOverrideReason" TEXT;

-- ── Hora propia del baño de perro hospedado ─────────────────────────────────
-- El baño de un hospedaje es un addon colgado de un STAY. La agenda lo colgaba
-- de la hora de CHECKOUT, que no es cuando se baña: ocupaba tiempo real de la
-- estilista sin aparecer en la agenda. Ahora lleva su propio horario.
ALTER TABLE "reservation_addons"
  ADD COLUMN IF NOT EXISTS "scheduledAt" TIMESTAMP(3);
ALTER TABLE "reservation_addons"
  ADD COLUMN IF NOT EXISTS "durationMinutes" INTEGER;

-- ── Configuración de la agenda ──────────────────────────────────────────────
-- slotStepMinutes: granularidad de los INICIOS que se ofrecen. Ya no es igual
--   a la duración: con paso de 30 min una cita de 2 h puede empezar a las 9:30.
-- defaultBathDurationMinutes: respaldo cuando no se puede resolver la variante.
-- lastStartHour: tope duro opcional del último inicio. NULL = se deriva solo
--   de la regla "inicio + duración + buffer <= closeHour", que es la que
--   resuelve el problema de fondo.
-- bufferMinutes: limpieza entre perro y perro. Arranca en 0 por decisión del
--   dueño; queda cableado para activarlo desde Configuración sin tocar código.
ALTER TABLE "bath_config"
  ADD COLUMN IF NOT EXISTS "slotStepMinutes" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "bath_config"
  ADD COLUMN IF NOT EXISTS "defaultBathDurationMinutes" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "bath_config"
  ADD COLUMN IF NOT EXISTS "lastStartHour" INTEGER;
ALTER TABLE "bath_config"
  ADD COLUMN IF NOT EXISTS "bufferMinutes" INTEGER NOT NULL DEFAULT 0;

-- Preservar el comportamiento vigente: la duración de respaldo arranca siendo
-- exactamente el slot que se venía usando.
UPDATE "bath_config"
  SET "defaultBathDurationMinutes" = "slotMinutes"
  WHERE id = 'singleton' AND "slotMinutes" > 0;

-- ── Siembra de la matriz de duraciones de BAÑO ──────────────────────────────
-- Valores iniciales derivados de la operación (el dueño los ajusta en
-- Configuración → Tarifas). Tallas según bathSizeKey:
--   S ≤5 kg · M 5–15 kg · L 15–24 kg · XL >24 kg
--
--   Talla │ Baño │ +Corte │ +Deslanado │ +Ambos
--   ──────┼──────┼────────┼────────────┼────────
--     S   │  60  │   90   │     90     │  120
--     M   │  60  │   90   │    120     │  150
--     L   │  90  │  120   │    150     │  180
--    XL   │ 120  │  150   │    180     │  210
--
-- Solo rellena filas vacías: nunca pisa lo que el equipo ya haya configurado.
UPDATE "service_variants" sv
  SET "durationMinutes" = CASE sv."petSize"::text
    WHEN 'S' THEN
      CASE WHEN sv.corte AND sv.deslanado THEN 120
           WHEN sv.corte                  THEN  90
           WHEN sv.deslanado              THEN  90
           ELSE                                 60 END
    WHEN 'M' THEN
      CASE WHEN sv.corte AND sv.deslanado THEN 150
           WHEN sv.corte                  THEN  90
           WHEN sv.deslanado              THEN 120
           ELSE                                 60 END
    WHEN 'L' THEN
      CASE WHEN sv.corte AND sv.deslanado THEN 180
           WHEN sv.corte                  THEN 120
           WHEN sv.deslanado              THEN 150
           ELSE                                 90 END
    WHEN 'XL' THEN
      CASE WHEN sv.corte AND sv.deslanado THEN 210
           WHEN sv.corte                  THEN 150
           WHEN sv.deslanado              THEN 180
           ELSE                                120 END
  END
  FROM "service_types" st
  WHERE sv."serviceTypeId" = st.id
    AND st.code = 'BATH'
    AND sv."durationMinutes" IS NULL;

-- ── Índice para la consulta de ocupación ────────────────────────────────────
-- El motor carga los baños de hospedaje del día por scheduledAt. Las citas
-- sueltas ya están cubiertas por reservations_reservationType_status_appointmentAt_idx.
CREATE INDEX IF NOT EXISTS "reservation_addons_scheduledAt_idx"
  ON "reservation_addons" ("scheduledAt");
