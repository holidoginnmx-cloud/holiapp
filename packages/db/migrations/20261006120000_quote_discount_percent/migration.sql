-- ============================================================================
-- quote_discount_percent — descuento por porcentaje en cotizaciones
-- ============================================================================
-- El formulario de cotización pedía un CÓDIGO de descuento, pero al cotizar el
-- equipo lo que negocia es un porcentaje ("te hago el 10%"), y para eso había
-- que dar de alta un código primero. Ahora se captura el porcentaje directo.
--
-- El monto descontado ya se congela en "discountTotal"; esta columna guarda el
-- porcentaje solo para poder rehidratar el formulario al editar la cotización.
-- Nullable: las cotizaciones existentes (con código o sin descuento) quedan en
-- NULL, que es justo "no se capturó porcentaje".
-- ============================================================================

ALTER TABLE "quotes"
  ADD COLUMN "discountPercent" DECIMAL(5, 2);
