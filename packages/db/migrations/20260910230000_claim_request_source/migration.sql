-- ============================================================================
-- De dónde salió una solicitud de vinculación de ficha.
--
-- Hasta ahora toda solicitud la abría el cliente con "Pedir que me vinculen mi
-- ficha", y quien no pulsaba el botón se quedaba con DOS registros sin que el
-- equipo se enterara: el de su ficha (con historial) y el de su cuenta de app.
-- El 10-sep Andrea Castro buscó su ficha, la encontró, siguió como nueva y
-- registró otra vez a Drago —que estaba hospedado— con su cartilla y la nota
-- de que muerde a otros perros, fuera de la ficha que ve el equipo.
--
-- Desde esta entrega el API abre la solicitud solo cuando el teléfono del
-- cliente coincide con una ficha sin vincular (AUTO), y el equipo puede abrirla
-- a mano (ADMIN). La bandeja necesita distinguirlas: una AUTO hay que
-- confirmarla con el cliente; una CLIENT ya la pidió él.
--
-- Aditiva con default: la API en producción no ve la columna y sigue
-- insertando igual (quedan como CLIENT, que es lo que son).
-- Reversible con DROP COLUMN + DROP TYPE.
-- ============================================================================

CREATE TYPE "ClaimRequestSource" AS ENUM ('CLIENT', 'AUTO', 'ADMIN');

ALTER TABLE "claim_requests"
  ADD COLUMN "source" "ClaimRequestSource" NOT NULL DEFAULT 'CLIENT';
