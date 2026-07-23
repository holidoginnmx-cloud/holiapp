-- ============================================================================
-- Comisión de Stripe por pago (payments.stripeFeeAmount).
--
-- El anticipo/pago hecho desde la app se guarda BRUTO en payments.amount (ej.
-- $360), pero Stripe descuenta su comisión y a la cuenta del negocio solo cae
-- el neto (ej. $341.49). Esta columna guarda la comisión (bruto - neto) para
-- que los ingresos globales del admin cuenten el neto real, sin tocar `amount`
-- (así el saldo pendiente y reconcile.ts siguen razonando en bruto).
--
-- La puebla el webhook payment_intent.succeeded leyendo
-- latest_charge.balance_transaction.fee, y un backfill one-shot para los
-- anticipos ya cobrados. NULL = efectivo/transferencia/terminal, o aún no
-- conciliado con Stripe. Idempotente.
-- ============================================================================

ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "stripeFeeAmount" NUMERIC(10,2);
