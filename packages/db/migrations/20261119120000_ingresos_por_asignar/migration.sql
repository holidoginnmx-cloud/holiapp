-- Anticipos sin reserva ("Por asignar"), pedido de Javier 2026-11-18.
--
-- Un pago PAID con reservationId y orderId en NULL es un anticipo que todavía
-- no se cuelga de su reserva (packages/api/src/lib/unassignedDeposits.ts).
-- Antes de esto la vista clasificaba TODO pago sin reservación como TIENDA;
-- ahora solo los que tienen pedido. El predicado de pagos_tienda sigue siendo
-- "sin reservación", así que el invariante
--   SUM(vw_ingresos_por_servicio.total) = vw_ingresos_mensuales.total_ingresos
-- se mantiene. Mismas columnas → CREATE OR REPLACE basta.
--
-- Copia de 20260904000001_dashboard_views con solo esos cambios.

create or replace view vw_ingresos_por_servicio as
with bano_por_reserva as (
  select
    a."reservationId"                  as rid,
    sum(a."unitPrice")::numeric(12, 2) as bano_base
  from reservation_addons a
  join service_variants sv on sv.id = a."variantId"
  join service_types    st on st.id = sv."serviceTypeId"
  -- Una CORTESÍA conserva el precio de catálogo en unitPrice pero NUNCA entró
  -- a totalAmount: si se restara del hospedaje, un baño regalado reclasificaría
  -- ingresos de HOTEL como ESTETICA.
  where st.code = 'BATH' and a."paidWith" = 'BOOKING'
    and coalesce(a."isCourtesy", false) = false
  group by a."reservationId"
),
deworm_por_reserva as (
  -- Desparasitante incluido (paidWith=BOOKING): ya está dentro de totalAmount.
  select
    a."reservationId"                  as rid,
    sum(a."unitPrice")::numeric(12, 2) as deworm_base
  from reservation_addons a
  join service_variants sv on sv.id = a."variantId"
  join service_types    st on st.id = sv."serviceTypeId"
  where st.code = 'DEWORMING' and a."paidWith" = 'BOOKING'
    and coalesce(a."isCourtesy", false) = false
  group by a."reservationId"
),
reembolsos as (
  -- Reembolsos (REFUNDED, monto positivo) restados en el mes de emisión, en la
  -- banda del servicio de la reserva (o TIENDA si cuelgan de un pedido). Sin
  -- esto la web sumaba lo cobrado de una reserva cancelada y devuelta.
  select
    extract(year  from (coalesce(p."paidAt", p."createdAt") at time zone 'UTC' at time zone 'America/Hermosillo'))::int as anio,
    extract(month from (coalesce(p."paidAt", p."createdAt") at time zone 'UTC' at time zone 'America/Hermosillo'))::int as mes_num,
    case r."reservationType"
      when 'STAY'    then 'HOTEL'
      when 'BATH'    then 'ESTETICA'
      when 'DAYCARE' then 'GUARDERIA'
      else case when p."orderId" is not null then 'TIENDA' else 'POR_ASIGNAR' end
    end as servicio,
    -(p.amount) as total
  from payments p
  left join reservations r on r.id = p."reservationId"
  where p.status = 'REFUNDED'
),
extra_por_reserva as (
  -- Extra del deslanado/corte ya cobrado (su Payment ya existe).
  select
    a."reservationId"                   as rid,
    sum(a."extraPrice")::numeric(12, 2) as extra_base
  from reservation_addons a
  join service_variants sv on sv.id = a."variantId"
  join service_types    st on st.id = sv."serviceTypeId"
  where st.code = 'BATH' and a."extraPaymentStatus" = 'PAID' and a."extraPrice" is not null
  group by a."reservationId"
),
pagos as (
  select
    extract(year  from (coalesce(p."paidAt", p."createdAt") at time zone 'UTC' at time zone 'America/Hermosillo'))::int as anio,
    extract(month from (coalesce(p."paidAt", p."createdAt") at time zone 'UTC' at time zone 'America/Hermosillo'))::int as mes_num,
    r."reservationType" as tipo,
    -- Neto real: se resta la comisión que absorbe el negocio (Stripe + terminal;
    -- NULL → 0 en efectivo/transferencia).
    (p.amount - coalesce(p."stripeFeeAmount", 0) - coalesce(p."cardFeeAmount", 0)) as monto,
    -- Baño incluido, extra y base del hospedaje (solo aplica a estancias STAY).
    case when r."reservationType" = 'STAY'
         then coalesce(b.bano_base, 0) else 0 end as bano_base,
    case when r."reservationType" = 'STAY'
         then coalesce(ex.extra_base, 0) else 0 end as extra_base,
    -- Desparasitante → ESTETICA solo si la estancia tiene baño (bano_base > 0).
    case when r."reservationType" = 'STAY' and coalesce(b.bano_base, 0) > 0
         then coalesce(d.deworm_base, 0) else 0 end as deworm_estetica,
    case when r."reservationType" = 'STAY'
         then greatest(
                coalesce(r."totalAmount", 0)
                - coalesce(b.bano_base, 0)
                - (case when coalesce(b.bano_base, 0) > 0 then coalesce(d.deworm_base, 0) else 0 end),
              0)
         else coalesce(r."totalAmount", 0) end    as hotel_base,
    -- Suma de pagos previos de la MISMA reserva, en orden cronológico. Define el
    -- punto del "waterfall" en el que entra este pago. También en neto para que
    -- las bandas del waterfall cuadren con `monto`.
    coalesce(sum(p.amount - coalesce(p."stripeFeeAmount", 0) - coalesce(p."cardFeeAmount", 0)) over (
      partition by p."reservationId"
      order by coalesce(p."paidAt", p."createdAt"), p."createdAt", p.id
      rows between unbounded preceding and 1 preceding
    ), 0) as running_before
  from payments p
  join reservations r on r.id = p."reservationId"
  left join bano_por_reserva    b  on b.rid  = r.id
  left join deworm_por_reserva  d  on d.rid  = r.id
  left join extra_por_reserva   ex on ex.rid = r.id
  where p.status in ('PAID', 'PARTIAL')
),
pagos_tienda as (
  -- Ingresos que NO cuelgan de una reservación: ventas de tienda (pedido en
  -- línea confirmado por el webhook de Stripe, o venta de mostrador capturada
  -- desde Movimientos) y, desde 2026-11-19, anticipos sin reserva todavía (el
  -- cliente pagó pero no mandó los datos del perro). Se separan por orderId.
  --
  -- Hace falta un CTE aparte porque `pagos` hace INNER JOIN a reservations y los
  -- descartaría: la suma de las bandas no cuadraría contra vw_ingresos_mensuales,
  -- que sí los cuenta. Tampoco se pueden meter en `pagos` con un LEFT JOIN: su
  -- window function particiona por "reservationId", y con NULLs todas las ventas
  -- caerían en una sola partición y el waterfall de baño/desparasitante correría
  -- entre bolsas de croquetas.
  --
  -- El predicado es "sin reservación" y no "con orderId" a propósito: así el
  -- invariante SUM(vw_ingresos_por_servicio.total) = total_ingresos se sostiene
  -- estructuralmente aunque mañana aparezca otro ingreso sin reserva.
  --
  -- No hay waterfall aquí (no hay add-ons que repartir): el monto neto entero es
  -- la banda.
  select
    extract(year  from (coalesce(p."paidAt", p."createdAt") at time zone 'UTC' at time zone 'America/Hermosillo'))::int as anio,
    extract(month from (coalesce(p."paidAt", p."createdAt") at time zone 'UTC' at time zone 'America/Hermosillo'))::int as mes_num,
    -- Con pedido → TIENDA. Sin pedido → anticipo que todavía no se asigna a su
    -- reserva (lib/unassignedDeposits.ts del API): POR_ASIGNAR.
    case when p."orderId" is not null then 'TIENDA' else 'POR_ASIGNAR' end as servicio,
    (p.amount - coalesce(p."stripeFeeAmount", 0) - coalesce(p."cardFeeAmount", 0)) as monto
  from payments p
  where p.status in ('PAID', 'PARTIAL')
    and p."reservationId" is null
),
atribuido as (
  select
    anio, mes_num, tipo, monto, bano_base, deworm_estetica, extra_base, hotel_base,
    running_before,
    running_before + monto as running_after
  from pagos
),
desglosado as (
  -- Porción del servicio base. En estancias con baño/desparasitante/extra, HOTEL
  -- recibe el monto del pago MENOS lo que cae en la banda de estética
  -- [hotel_base, hotel_base + bano_base + deworm_estetica + extra_base] (así
  -- hotel + estética = monto y el total cuadra; el sobrepago queda en HOTEL).
  select
    anio,
    mes_num,
    case tipo
      when 'STAY'    then 'HOTEL'
      when 'BATH'    then 'ESTETICA'
      when 'DAYCARE' then 'GUARDERIA'
    end as servicio,
    case
      when tipo = 'STAY' and (bano_base + deworm_estetica + extra_base) > 0
      then monto - greatest(0, least(running_after, hotel_base + bano_base + deworm_estetica + extra_base) - greatest(running_before, hotel_base))
      else monto
    end as total
  from atribuido
  union all
  -- Baño + desparasitante + extra → ESTETICA: lo que cae en la banda de estética.
  select
    anio,
    mes_num,
    'ESTETICA' as servicio,
    greatest(0, least(running_after, hotel_base + bano_base + deworm_estetica + extra_base) - greatest(running_before, hotel_base)) as total
  from atribuido
  where tipo = 'STAY' and (bano_base + deworm_estetica + extra_base) > 0
  union all
  -- Ventas de tienda (mostrador y en línea) → TIENDA; anticipos sin reserva →
  -- POR_ASIGNAR (ver pagos_tienda).
  select anio, mes_num, servicio, monto as total
  from pagos_tienda
  union all
  -- Reembolsos → restan en su banda.
  select anio, mes_num, servicio, total
  from reembolsos
)
select
  anio,
  mes_num,
  servicio,
  sum(total)::numeric(12, 2) as total,
  count(*) filter (where total > 0) as cantidad_pagos
from desglosado
where total <> 0
group by 1, 2, 3;
