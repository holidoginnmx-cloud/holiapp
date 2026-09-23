-- ============================================================================
-- Marca de "los videos de este reporte ya se borraron".
--
-- Decisión del equipo (14-sep-2026): para volver al plan gratuito de
-- Cloudinary, los VIDEOS de evidencia se borran en cuanto la reservación
-- termina. Las fotos se quedan (0.3 GB contra 19.7 GB de video).
--
-- El reporte diario guarda `videosCount` como registro de lo que el equipo
-- subió ese día, y ese registro NO se toca: sirve para saber que el trabajo se
-- hizo. Pero sin esta columna la tarjeta anunciaría "3 videos" y no habría
-- ninguno que abrir, que se lee como una falla de la app. Con la marca, la
-- tarjeta dice "3 videos · ya no disponibles".
--
-- Aditiva y nullable: la API en producción no ve la columna y sigue insertando
-- igual. NULL = este reporte nunca ha sido purgado.
-- Reversible con DROP COLUMN.
-- ============================================================================

ALTER TABLE "daily_checklists" ADD COLUMN "videosPurgedAt" TIMESTAMP(3);
