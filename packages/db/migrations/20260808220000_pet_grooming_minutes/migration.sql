-- ============================================================================
-- Duración de baño propia por perro.
--
-- La agenda calcula cuánto dura un baño con la tabla `service_variants`
-- (talla × corte × deslanado). Esa tabla es un promedio: en la práctica hay
-- perros que se salen de su talla — el que no se deja, el de pelo enredado, el
-- que ya se conoce y sale en la mitad del tiempo. Sin manera de anotarlo, el
-- equipo terminaba con citas encimadas o con huecos muertos.
--
-- `pets.groomingMinutes` es la excepción por perro: cuando trae valor, manda
-- sobre la tabla al agendar. Los extras (corte/deslanado) siguen sumando el
-- mismo incremento que define la tabla para su talla.
--
-- Aditivo y nullable: el código en producción no ve la columna y sigue
-- funcionando igual hasta que se despliegue la API. NULL = regla general.
-- ============================================================================

ALTER TABLE "pets"
  ADD COLUMN IF NOT EXISTS "groomingMinutes" INTEGER;
