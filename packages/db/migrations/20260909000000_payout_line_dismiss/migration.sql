-- ============================================================================
-- Descartar un cobro de un depósito de Stripe.
--
-- La conciliación marca como "sin registrar" toda línea que Stripe depositó y
-- que no tiene fila en `payments`. La lectura por defecto es correcta —dinero
-- que entró y que los ingresos no cuentan—, pero no siempre:
--
--   * cobros de prueba (cuentas del equipo, la cuenta demo de la revisión de
--     Apple), que ni siquiera tienen reserva;
--   * dinero YA capturado a mano en otra reserva. Pasa cuando la ficha de la
--     mascota se duplicó: el cliente pagó con una, la reserva se rehízo con la
--     otra y el pago se registró ahí. Darlo de alta otra vez duplicaría el
--     ingreso, que es justo lo contrario de lo que la pantalla busca.
--
-- Para esos el aviso ámbar se quedaba encendido para siempre: la única acción
-- ofrecida era "Registrar como pago", la que NO hay que tocar.
--
-- Descartar no borra ni modifica la línea (el desglose tiene que seguir sumando
-- el monto exacto del banco): sólo la saca del conteo de pendientes y deja
-- constancia de quién y por qué. Se deshace desde la misma pantalla.
--
-- Aditiva y toda nullable: la API en producción no ve estas columnas y sigue
-- funcionando idéntico hasta que se despliegue la versión nueva.
-- Reversible con DROP COLUMN × 4 + DROP TYPE.
-- ============================================================================

-- Catálogo cerrado y no texto libre: el motivo se lee meses después, cuando ya
-- nadie se acuerda, y "prueba" escrito de seis formas no se puede filtrar.
CREATE TYPE "PayoutLineDismissReason" AS ENUM ('PRUEBA', 'YA_REGISTRADO', 'REEMBOLSADO', 'OTRO');

ALTER TABLE "stripe_payout_lines"
  ADD COLUMN "dismissedAt"     TIMESTAMP(3),
  ADD COLUMN "dismissedReason" "PayoutLineDismissReason",
  ADD COLUMN "dismissedNote"   TEXT,
  -- Texto y no FK a `users`: quien descarta puede ser un admin del panel web,
  -- que autentica contra otra instancia de Clerk y no tiene fila ahí.
  ADD COLUMN "dismissedBy"     TEXT;
