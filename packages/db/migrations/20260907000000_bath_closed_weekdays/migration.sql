-- ============================================================================
-- Días de la semana en que la estética no abre ("los lunes no hay baños").
--
-- Hasta ahora la agenda sólo sabía apagarse ENTERA (bath_config.isActive) o
-- acotar la jornada por HORAS (openHour/closeHour/lastStartHour). El negocio
-- cierra por DÍA: la estilista descansa el lunes y la agenda seguía ofreciendo
-- horarios de lunes, que alguien tenía que cancelar a mano cada semana.
--
-- Convención: 0 = domingo … 6 = sábado, la misma numeración de JavaScript
-- (getUTCDay), para que el motor no tenga que traducir nada. El día se decide
-- SIEMPRE en hora del hotel (UTC-7 fijo), nunca en la del servidor: en UTC una
-- cita del domingo a las 6 pm de Hermosillo ya cayó en lunes, y sin el
-- corrimiento cerrar los lunes mataría también la última hora de los domingos.
--
-- Aditiva y con default vacío: el código en producción no ve la columna y
-- sigue funcionando idéntico hasta que se despliegue la API nueva. Reversible
-- con  ALTER TABLE "bath_config" DROP COLUMN "closedWeekdays".
-- ============================================================================

ALTER TABLE "bath_config"
  ADD COLUMN IF NOT EXISTS "closedWeekdays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
